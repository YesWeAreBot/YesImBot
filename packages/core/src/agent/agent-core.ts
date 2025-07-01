import { Context, Schema, Session } from "koishi";
import {
    AgentResponse,
    AgentTurn,
    createTool,
    DialogueSegment,
    Failed,
    ModelGroup,
    ModelService,
    ModelSwitcher,
    Services,
    Success,
    TableName,
    ToolDefinition,
    ToolExecutionContext,
    ToolService,
    WorldStateService,
} from "../services";
import { JsonParser } from "../shared";
import { AgentConfig } from "./config";
import { ConversationFlowAnalyzer, FlowAnalysis } from "./conversation-flow-analyzer";
import { PromptBuilder, PromptContext } from "./prompt-builder";
import { Willingness, WillingnessCalculator } from "./willingness-calculator";

export class AgentCore {
    static readonly inject = [Services.WorldState, Services.Model, Services.Tool, Services.Memory, Services.Platform];

    // 依赖的服务
    private worldState: WorldStateService;
    private modelService: ModelService;
    private toolService: ToolService;

    // 内部组件
    private flowAnalyzer: ConversationFlowAnalyzer;
    private willingnessCalculator: WillingnessCalculator;
    private promptBuilder: PromptBuilder;
    private parser: JsonParser<AgentResponse>;
    private modelSwitcher: ModelSwitcher;

    // 内部状态
    private allowedChannels = new Set<string>();
    private channelGroupMap = new Map<string, { Platform: string; Id: string }[]>();
    private channelWillingness = new Map<string, number>();
    private willingnessDecayTimer: NodeJS.Timeout;
    private debounceTimers = new Map<string, NodeJS.Timeout>();

    constructor(private ctx: Context, private config: AgentConfig) {
        this.config = config;

        // [REFACTOR] 通过 inject 获取服务实例
        this.worldState = this.ctx[Services.WorldState];
        this.modelService = this.ctx[Services.Model];
        this.toolService = this.ctx[Services.Tool];

        // 实例化内部组件
        this.flowAnalyzer = new ConversationFlowAnalyzer(this.ctx);
        this.willingnessCalculator = new WillingnessCalculator(this.ctx, this.config.Willingness);
        this.promptBuilder = new PromptBuilder(this.ctx, this.config.Prompt);
        this.parser = new JsonParser<AgentResponse>();
        this.modelSwitcher = this.modelService.useGroup(ModelGroup.Chat);

        ctx.on("ready", async () => {
            await this.start();
        });

        ctx.on("dispose", () => {
            this.stop();
        });
    }

    protected async start(): Promise<void> {
        this.ctx.logger.info("Agent Service started.");
        this.updateAllowedChannels();
        this.ctx.on("config", () => this.updateAllowedChannels());

        this.ctx.on("worldstate:segment-updated", (session, segment) => {
            try {
                if (!this.isChannelAllowed(segment.platform, segment.channelId)) return;
                this.handleSegmentUpdate(session, segment);
            } catch (e) {
                this.ctx.logger.info(e.message);
            }
        });

        this.startWillingnessDecay();

        this.toolService.registerTool(await this.createMessageTool());
    }

    protected stop(): void {
        this.ctx.logger.info("Agent Service stopped.");
        this.debounceTimers.forEach(clearTimeout);
        clearInterval(this.willingnessDecayTimer);
    }

    // [ADD] 新增和完善的私有方法
    private updateAllowedChannels(): void {
        this.allowedChannels.clear();
        this.config.Arousal.AllowedChannelGroups.forEach((group) => {
            group.forEach(({ Platform, Id }) => {
                this.allowedChannels.add(`${Platform}:${Id}`);
            });
        });
    }

    private isChannelAllowed(platform: string, channelId: string): boolean {
        return this.allowedChannels.has(`${platform}:${channelId}`);
    }

    private startWillingnessDecay(): void {
        this.willingnessDecayTimer = setInterval(() => {
            for (const [channelId, willingness] of this.channelWillingness) {
                const decayed = Math.max(0, willingness - this.config.Willingness.DecayPerMinute);
                this.channelWillingness.set(channelId, decayed);
            }
        }, 60000);
    }

    private handleSegmentUpdate(session: Session, segment: DialogueSegment): void {
        const channelKey = `${segment.platform}:${segment.channelId}`;
        if (this.debounceTimers.has(channelKey)) {
            clearTimeout(this.debounceTimers.get(channelKey));
        }
        this.debounceTimers.set(
            channelKey,
            setTimeout(() => {
                this.ctx.logger.info(`Debounce timer triggered for channel ${channelKey}. Starting decision process...`);
                this.decideToAct(session, segment);
                this.debounceTimers.delete(channelKey);
            }, this.config.Arousal.DebounceMs)
        );
    }

    private async decideToAct(session: Session, segment: DialogueSegment): Promise<void> {
        this.ctx.logger.info(`[DECISION] Evaluating channel ${segment.platform}:${segment.channelId}`);

        const analysis = this.flowAnalyzer.analyze(segment);
        const currentWillingness = this.channelWillingness.get(segment.channelId) || 0;
        const willingness = this.willingnessCalculator.calculate(analysis, currentWillingness);

        if (this.config.Debug.LogDecisionDetails) {
            this.ctx.logger.info(
                `[DECISION] ${segment.channelId} | W: ${currentWillingness.toFixed(2)} -> ${willingness.value.toFixed(2)} | T: ${
                    willingness.threshold
                } | Act: ${willingness.shouldAct} | R: ${willingness.reasons.join("; ")}`
            );
        }

        if (willingness.shouldAct) {
            const retainedWillingness = willingness.value * this.config.Willingness.RetentionAfterReply;
            this.channelWillingness.set(segment.channelId, retainedWillingness);
            await this.executeThinkingCycle(session, segment, analysis, willingness);
        } else {
            this.channelWillingness.set(segment.channelId, willingness.value);
        }
    }

    public async executeThinkingCycle(
        session: Session,
        segment: DialogueSegment,
        analysis: FlowAnalysis,
        willingness: Willingness
    ): Promise<void> {
        let agentTurnRecord: AgentTurn;
        let shouldContinueHeartbeat = true;
        let heartbeatCount = 0;
        const agentTurnHistory: AgentTurn[] = [];

        while (shouldContinueHeartbeat && heartbeatCount < this.config.Chat.MaxHeartbeat) {
            heartbeatCount++;

            let allowedChannels = this.channelGroupMap.get(segment.channelId);

            if (!allowedChannels) {
                allowedChannels = this.config.Arousal.AllowedChannelGroups.find((group) =>
                    group.some((channel) => channel.Platform === segment.platform && channel.Id === segment.channelId)
                );
                this.channelGroupMap.set(segment.channelId, allowedChannels);
            }

            const promptContext = await this.buildPromptContext(
                allowedChannels,
                session.platform,
                segment,
                analysis,
                willingness,
                agentTurnHistory
            );
            const { system, user } = await this.promptBuilder.build(promptContext);

            const chatModel = this.modelSwitcher.getCurrent();

            const llmRawResponse = await chatModel.chat(
                [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                {
                    debug: this.config.Debug.LogDecisionDetails,
                    logger: this.ctx.logger("AgentCore"),
                }
            );

            const llmParsedResponse = this.parser.parse(llmRawResponse.text);

            if (llmParsedResponse.error || !llmParsedResponse.data) {
                this.ctx.logger.warn(`[THINK] Failed to parse LLM response: ${llmParsedResponse.error}. Raw: ${llmRawResponse.text}`);
                shouldContinueHeartbeat = false;
                continue;
            }

            // 请求成功后再新建助手回合
            if (!agentTurnRecord) {
                agentTurnRecord = await this.worldState.createAgentTurn(segment);
            }

            const validResponse = llmParsedResponse.data;

            const context: ToolExecutionContext = {
                koishiContext: this.ctx,
                koishiSession: session,
                platform: this.ctx[Services.Platform],
                logger: this.ctx.logger("tool-exec"),
                extensionConfig: {},
            };

            const observations = await Promise.all(
                validResponse.actions.map(async (action) => {
                    const result = await this.toolService.executeToolCall(context, action.function, action.params);
                    return { function: action.function, status: result.status, result: result.result, error: result.error };
                })
            );

            const agentResponse: AgentResponse = { ...validResponse, observations };
            await this.ctx.database.create(TableName.AgentResponses, {
                turnId: agentTurnRecord.id,
                thoughts: agentResponse.thoughts,
                actions: agentResponse.actions,
                observations: agentResponse.observations,
            });

            // 填充 agentTurnHistory 以便在循环中使用
            agentTurnHistory.push({ ...agentTurnRecord, responses: [agentResponse] });

            shouldContinueHeartbeat = validResponse.request_heartbeat;
        }

        // 3. 结束循环并更新状态
        if (heartbeatCount >= this.config.Chat.MaxHeartbeat) {
            this.ctx.logger.warn(`[THINK] Max heartbeat reached for turn ${agentTurnRecord.id}.`);
        }

        await this.ctx.database.set(TableName.AgentTurns, { id: agentTurnRecord.id }, { status: "completed" });

        await this.ctx.database.set(TableName.DialogueSegments, { id: segment.id }, { status: "closed" });

        this.ctx.logger.info(`[THINK] ✅ Turn ${agentTurnRecord.id} completed.`);
    }

    private async buildPromptContext(
        allowedChannels: { Platform: string; Id: string }[],
        platform: string,
        segment: DialogueSegment,
        analysis: FlowAnalysis,
        willingness: Willingness,
        agentTurnHistory: AgentTurn[]
    ): Promise<PromptContext> {
        return {
            toolSchemas: this.toolService.getToolSchemas(),
            memory: await this.ctx["yesimbot.memory"].getProvider(),
            worldState: await this.worldState.getWorldState(allowedChannels),
            currentSegment: segment,
            agentState: {
                lifeCycleStatus: "active",
                analysis: analysis,
                willingness: willingness,
            },
            agentTurnHistory: agentTurnHistory,
        };
    }

    private async createMessageTool(): Promise<ToolDefinition> {
        return createTool({
            name: "send_message",
            description: "Sends a message to the human user.",
            parameters: Schema.object({
                inner_thoughts: Schema.string().description("仅供自己参考的内心独白。"),
                message: Schema.string().description("Message content"),
                channel_id: Schema.string().description("The ID of the channel where the message should be sent"),
            }),
            execute: async ({ koishiSession }, { message, channel_id }) => {
                if (!koishiSession) {
                    return Failed("Missing session object");
                }

                const messages = message.split("<sep/>");

                let channelId = channel_id || koishiSession.channelId;

                const result = [];
                try {
                    for (const msg of messages) {
                        result.push(await koishiSession.bot.sendMessage(channelId, msg));
                    }

                    return Success();
                } catch (error) {
                    return Failed(`Failed to send message: ${error.message}`);
                }
            },
        });
    }
}
