import { Context, h, Random, Schema, Service, Session } from "koishi";
import {
    AgentResponse,
    createTool,
    DialogueSegment,
    Failed,
    ModelGroup,
    ModelService,
    ModelSwitcher,
    Services,
    Success,
    ToolDefinition,
    ToolExecutionContext,
    ToolService,
    WorldStateService,
} from "../services";
import { JsonParser } from "../shared";
import { ConversationFlowAnalyzer, FlowAnalysis } from "./conversation-flow-analyzer";
import { PromptBuilder, PromptContext } from "./prompt-builder";
import { Willingness, WillingnessCalculator } from "./willingness-calculator";
import { AgentBehaviorConfig, ChannelDescriptor } from "./config";
import { ImagePart, TextPart } from "xsai";

const LOG_PREFIX = "[AgentCore]";

export class AgentCore extends Service<AgentBehaviorConfig> {
    static readonly inject = [Services.WorldState, Services.Model, Services.Tool, Services.Memory, Services.Image];

    // 依赖的服务
    private readonly worldState: WorldStateService;
    private readonly modelService: ModelService;
    private readonly toolService: ToolService;

    // 内部组件
    private readonly flowAnalyzer: ConversationFlowAnalyzer;
    private readonly willingnessCalculator: WillingnessCalculator;
    private readonly promptBuilder: PromptBuilder;
    private readonly parser: JsonParser<AgentResponse>;
    private readonly modelSwitcher: ModelSwitcher;

    // 内部状态
    private readonly allowedChannels = new Set<string>();
    private readonly channelGroupMap = new Map<string, ChannelDescriptor[]>();
    private readonly channelWillingness = new Map<string, number>();
    private willingnessDecayTimer: NodeJS.Timeout;
    private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

    constructor(ctx: Context, config: AgentBehaviorConfig) {
        super(ctx, "agent", true);
        this.ctx = ctx;
        this.config = config;

        this.ctx.logger.name = LOG_PREFIX;

        this.worldState = this.ctx[Services.WorldState];
        this.modelService = this.ctx[Services.Model];
        this.toolService = this.ctx[Services.Tool];

        // 实例化内部组件
        this.flowAnalyzer = new ConversationFlowAnalyzer(this.ctx);
        this.willingnessCalculator = new WillingnessCalculator(this.ctx, this.config.willingness);
        this.promptBuilder = new PromptBuilder(this.ctx, this.config.prompt);
        this.parser = new JsonParser<AgentResponse>();
        this.modelSwitcher = this.modelService.useGroup(ModelGroup.Chat);
    }

    protected async start(): Promise<void> {
        this.updateAllowedChannels();
        this.ctx.on("config", () => this.updateAllowedChannels());

        this.ctx.on("worldstate:segment-updated", (session, segment) => {
            try {
                // 从 worldstate 接收到的消息即为过滤后的，在回复列表中
                // if (!this.isChannelAllowed(segment.platform, segment.channelId)) return;
                this.handleSegmentUpdate(session, segment);
            } catch (error) {
                this.handleError(error, "handling segment update");
            }
        });

        this.startWillingnessDecay();
        this.toolService.registerTool(await this.createMessageTool());
        this.ctx.logger.info("Service started.");
    }

    protected stop(): void {
        this.debounceTimers.forEach(clearTimeout);
        clearInterval(this.willingnessDecayTimer);
        this.ctx.logger.info("Service stopped.");
    }

    private updateAllowedChannels(): void {
        this.allowedChannels.clear();
        this.config.arousal.allowedChannelGroups.forEach((group) => {
            group.forEach(({ platform, id }) => {
                this.allowedChannels.add(`${platform}:${id}`);
            });
        });
        this.ctx.logger.debug(`Allowed channels updated. Total: ${this.allowedChannels.size}`);
    }

    private startWillingnessDecay(): void {
        this.willingnessDecayTimer = setInterval(() => {
            for (const [channelKey, willingness] of this.channelWillingness) {
                const decayed = Math.max(0, willingness - this.config.willingness.advanced.decayPerMinute);
                this.channelWillingness.set(channelKey, decayed);
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
            }, this.config.arousal.debounceMs)
        );
    }

    private async decideToAct(session: Session, segment: DialogueSegment): Promise<void> {
        this.ctx.logger.info(`[Decision] Evaluating channel ${segment.platform}:${segment.channelId}, segment: ${segment.id}`);

        try {
            const analysis = this.flowAnalyzer.analyze(segment);
            const currentWillingness = this.channelWillingness.get(segment.channelId) || 0;
            const willingness = this.willingnessCalculator.calculate(analysis, currentWillingness);

            if (this.config.willingness.advanced.testMode) {
                this.ctx.logger.info(
                    `[Decision] ${segment.channelId} | W: ${currentWillingness.toFixed(2)} -> ${willingness.value.toFixed(2)} | T: ${
                        willingness.threshold
                    } | Act: ${willingness.shouldAct} | R: ${willingness.reasons.join("; ")}`
                );
            }

            if (willingness.shouldAct) {
                const retainedWillingness = willingness.value * this.config.willingness.advanced.retentionAfterReply;
                this.channelWillingness.set(segment.channelId, retainedWillingness);
                await this.runAgentCycle(session, segment, analysis, willingness);
            } else {
                this.channelWillingness.set(segment.channelId, willingness.value);
            }
        } catch (error) {
            this.handleError(error, `in decision process for segment ${segment.id}`);
        }
    }

    private async runAgentCycle(
        session: Session,
        segment: DialogueSegment,
        analysis: FlowAnalysis,
        willingness: Willingness
    ): Promise<void> {
        this.ctx.logger.info(`[Cycle] Starting for segment ${segment.id}`);
        const collectedResponses: AgentResponse[] = [];
        let shouldContinueHeartbeat = true;
        let heartbeatCount = 0;

        while (shouldContinueHeartbeat && heartbeatCount < this.config.heartbeat) {
            heartbeatCount++;
            this.ctx.logger.debug(`[Cycle] Heartbeat #${heartbeatCount} for segment ${segment.id}`);

            try {
                const promptContext = await this.buildPromptContext(segment, analysis, willingness, collectedResponses);
                const { system, user } = await this.promptBuilder.build(promptContext);

                const chatModel = this.modelSwitcher.getCurrent();
                const llmRawResponse = await chatModel.chat(
                    [
                        { role: "system", content: system },
                        { role: "user", content: user },
                    ],
                    {
                        debug: this.config.system.debug.enable,
                        logger: this.ctx.logger("[LLM]"),
                    }
                );

                const llmParsedResponse = this.parser.parse(llmRawResponse.text);

                if (llmParsedResponse.error || !llmParsedResponse.data) {
                    this.ctx.logger.warn(`[Cycle] Failed to parse LLM response: ${llmParsedResponse.error}. Raw: ${llmRawResponse.text}`);
                    shouldContinueHeartbeat = false;
                    continue;
                }

                const agentResponseData = llmParsedResponse.data;

                // 验证响应格式
                if (!Array.isArray(agentResponseData.actions)) {
                    this.ctx.logger.warn(`[Cycle] Invalid actions format. Expected array, got ${typeof agentResponseData.actions}`);
                    shouldContinueHeartbeat = false;
                    continue;
                }

                const observations = await this.executeActions(session, agentResponseData.actions);

                const fullResponse: AgentResponse = { ...agentResponseData, observations };
                collectedResponses.push(fullResponse);

                // [NEW] 核心逻辑：检查成功的 send_message 操作并记录
                await this.recordSentMessages(segment.id, session, agentResponseData.actions, observations);

                shouldContinueHeartbeat = agentResponseData.request_heartbeat;
            } catch (error) {
                this.handleError(error, `during heartbeat #${heartbeatCount} for segment ${segment.id}`);
                shouldContinueHeartbeat = false; // 出现意外错误，停止循环
            }
        }

        // 无论循环如何结束，只要有响应，就记录下来
        if (collectedResponses.length > 0) {
            this.ctx.logger.info(`[Cycle] Saving ${collectedResponses.length} responses for segment ${segment.id}`);
            await this.worldState.recordAgentTurn(segment, collectedResponses);
            this.ctx.logger.info(`[Cycle] ✅ Completed for segment ${segment.id}.`);
        } else {
            this.ctx.logger.warn(`[Cycle] ⚠️ Completed for segment ${segment.id} with no actions taken.`);
        }

        if (heartbeatCount >= this.config.heartbeat) {
            this.ctx.logger.warn(`[Cycle] Max heartbeat reached for segment ${segment.id}.`);
        }
    }

    private async executeActions(session: Session, actions: AgentResponse["actions"]): Promise<AgentResponse["observations"]> {
        const context: ToolExecutionContext = {
            koishiContext: this.ctx,
            koishiSession: session,
            logger: this.ctx.logger("tool-exec"),
            extensionConfig: {},
        };

        return Promise.all(
            actions.map(async (action) => {
                const result = await this.toolService.executeToolCall(context, action.function, action.params);
                return { function: action.function, status: result.status, result: result.result, error: result.error };
            })
        );
    }

    private async buildPromptContext(
        segment: DialogueSegment,
        analysis: FlowAnalysis,
        willingness: Willingness,
        previousResponses: AgentResponse[]
    ): Promise<PromptContext> {
        const allowedChannels =
            this.channelGroupMap.get(segment.channelId) ||
            this.config.arousal.allowedChannelGroups.find((group) =>
                group.some((channel) => channel.platform === segment.platform && channel.id === segment.channelId)
            );
        if (allowedChannels && !this.channelGroupMap.has(segment.channelId)) {
            this.channelGroupMap.set(segment.channelId, allowedChannels);
        }

        const worldState = await this.worldState.getWorldState(allowedChannels || []);

        // [核心修改] 提取图片并构建多模态内容
        const imageService = this.ctx[Services.Image];
        const imagePlaceholders = new Set<string>();

        // 1. 扫描历史记录，提取所有唯一的图片ID，并构建纯文本历史
        for (const channel of worldState.activeChannels) {
            for (const seg of channel.history) {
                for (const msg of seg.dialogue) {
                    const elements = h.parse(msg.content);
                    const imageElements = elements.filter((e) => e.type === "img" || e.type === "image");
                    if (imageElements.length > 0) {
                        for (const img of imageElements) {
                            imagePlaceholders.add(img.attrs.id);
                        }
                    }
                }
            }
        }

        // 2. 根据图片ID获取图片内容
        const multiModalContent: (ImagePart | TextPart)[] = [];
        if (imagePlaceholders.size > 0) {
            this.logger.info(`Found ${imagePlaceholders.size} unique images in context.`);
            const imageFetchPromises = Array.from(imagePlaceholders).map((id) => imageService.getImageDataWithContent(id));
            const imageDataResults = await Promise.all(imageFetchPromises);

            for (const result of imageDataResults) {
                if (result) {
                    multiModalContent.push({
                        type: "text",
                        text: `Image #${result.data.id}`,
                    });
                    multiModalContent.push({
                        type: "image_url",
                        image_url: { url: result.content },
                    });
                }
            }
        }

        // [NEW] 核心逻辑：在 worldState 中查找并标记当前 segment
        for (const channel of worldState.activeChannels) {
            const currentSegmentInHistory = channel.history.find((s) => s.id === segment.id);
            if (currentSegmentInHistory) {
                // 添加一个 Mustache 可以识别的标记
                (currentSegmentInHistory as any).is_current = true;
                break; // 找到后即可退出循环
            }
        }

        return {
            toolSchemas: this.toolService.getToolSchemas(),
            memory: await this.ctx[Services.Memory].getProvider(),
            worldState: worldState, // 传递已标记的 worldState
            // currentSegment 不再需要
            agentState: {
                lifeCycleStatus: "active",
                analysis: analysis,
                willingness: willingness,
            },

            previousResponses: previousResponses,
            multiModalData: {
                images: multiModalContent,
            },
        };
    }

    // [NEW] 统一的错误处理函数
    private handleError(error: unknown, context: string): void {
        if (error instanceof Error) {
            this.ctx.logger.error(`An error occurred ${context}: ${error.message}\n${error.stack}`);
        } else {
            this.ctx.logger.error(`An unknown error occurred ${context}:`, error);
        }
    }

    // [NEW] 新增一个方法，专门负责处理和记录AI发送的消息
    private async recordSentMessages(
        segmentId: string,
        session: Session,
        actions: AgentResponse["actions"],
        observations: AgentResponse["observations"]
    ): Promise<void> {
        for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            const observation = observations[i];

            if (action.function === "send_message" && observation.status === "success") {
                const params = action.params as { message: string; channel_id?: string };
                const messages = params.message.split("<sep/>").filter(Boolean);
                const channelId = params.channel_id || session.channelId;

                for (const msgContent of messages) {
                    // 为每条消息创建一个唯一的ID
                    const messageId = `ai_${Date.now()}_${Random.id(8)}`;

                    await this.worldState.recordMessage(segmentId, {
                        id: messageId,
                        platform: session.platform,
                        channelId: channelId,
                        sender: {
                            pid: session.selfId,
                            name: session.bot.user.name,
                        },
                        content: msgContent,
                        timestamp: new Date(),
                    });
                }
            }
        }
    }

    private async createMessageTool(): Promise<ToolDefinition> {
        return createTool({
            name: "send_message",
            description: "Sends a message to the human user.",
            parameters: Schema.object({
                inner_thoughts: Schema.string().description("仅供自己参考的内心独白。"),
                message: Schema.string().description("Message content to send. You can use '<sep/>' to send multiple messages."),
                channel_id: Schema.string().description("Optional. The ID of the channel where the message should be sent."),
            }),
            execute: async ({ koishiSession }, { message, channel_id }) => {
                if (!koishiSession) {
                    this.ctx.logger.warn("SendMessageTool called without a valid session.");
                    return Failed("Missing session object");
                }

                try {
                    const messages = message.split("<sep/>");
                    const channelId = channel_id || koishiSession.channelId;
                    for (const msg of messages) {
                        if (msg) {
                            const ids = await koishiSession.bot.sendMessage(channelId, msg);
                        }
                    }
                    return Success();
                } catch (error) {
                    this.handleError(error, `sending message to channel ${channel_id || koishiSession.channelId}`);
                    return Failed(`Failed to send message: ${error.message}`);
                }
            },
        });
    }
}
