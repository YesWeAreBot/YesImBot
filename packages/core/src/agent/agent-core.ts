import { Context, Random, Session } from "koishi";
import {
    Action,
    ActionResult,
    AgentResponse,
    AgentTurn,
    ChatModel,
    DialogueSegment,
    LLMAdapterManager,
    LLMRetryManager,
    ModelService,
    Services,
    TableName,
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
    private ctx: Context;
    private config: AgentConfig;

    // 依赖 WorldState 服务
    private worldState: WorldStateService;
    private modelService: ModelService;
    private toolService: ToolService;

    // 内部组件
    private flowAnalyzer: ConversationFlowAnalyzer;
    private willingnessCalculator: WillingnessCalculator;
    private parser: JsonParser<AgentResponse>;

    private promptBuilder: PromptBuilder;

    private retryManager: LLMRetryManager;
    private adapterManager: LLMAdapterManager;

    // 用于防抖的计时器 Map
    private debounceTimers = new Map<string, NodeJS.Timeout>();

    constructor(ctx: Context, config: AgentConfig) {
        this.config = config;
        this.worldState = ctx[Services.WorldState];
        this.modelService = ctx[Services.Model];

        // 实例化内部组件
        this.flowAnalyzer = new ConversationFlowAnalyzer(ctx);
        this.willingnessCalculator = new WillingnessCalculator(ctx, this.config.Willingness);

        this.promptBuilder = new PromptBuilder(ctx, config.Prompt);
    }

    protected start(): void {
        this.ctx.logger.info("Agent Service started.");

        // 监听 WorldStateService 广播的事件
        this.ctx.on("worldstate:segment-updated", (session, segmentId, channelId, platform) => {
            this.handleSegmentUpdate(session, segmentId, channelId, platform);
        });
    }

    protected stop(): void {
        this.ctx.logger.info("Agent Service stopped.");
        this.debounceTimers.forEach(clearTimeout);
    }

    private handleSegmentUpdate(session: Session, segmentId: string, channelId: string, platform: string): void {
        const channelKey = `${platform}:${channelId}`;

        // 清除旧的计时器
        if (this.debounceTimers.has(channelKey)) {
            clearTimeout(this.debounceTimers.get(channelKey));
        }

        // 设置新的防抖计时器
        const debounceMs = this.config.Arousal.DebounceMs || 1500;
        this.debounceTimers.set(
            channelKey,
            setTimeout(() => {
                this.ctx.logger.info(`Debounce timer triggered for channel ${channelKey}. Starting decision process...`);
                this.decideToAct(session, channelId, platform);
                this.debounceTimers.delete(channelKey);
            }, debounceMs)
        );
    }

    private async decideToAct(session: Session, channelId: string, platform: string): Promise<void> {
        this.ctx.logger.info(`[DECISION] Evaluating channel ${platform}:${channelId}`);

        // 1. 获取最新的开放对话片段
        const segmentRecord = await this.worldState.findOpenSegmentRecord(channelId, platform); // 假设的方法
        if (!segmentRecord) {
            this.ctx.logger.warn(`[DECISION] No open segment found for ${platform}:${channelId}. Aborting.`);
            return;
        }

        const channelRecord = await this.worldState.getChannelRecord(channelId, platform); // 假设的方法
        if (!channelRecord || !channelRecord.guildId) {
            this.ctx.logger.warn(`[DECISION] No guildId found for ${platform}:${channelId}. Aborting.`);
            return;
        }

        // 2. 将原始数据水合成用于分析的领域对象
        const segmentToAnalyze = await this.worldState.segments.hydrateSegment(segmentRecord, platform, channelRecord.guildId, channelId);

        // 2. 调用分析器
        const analysis: FlowAnalysis = this.flowAnalyzer.analyze(segmentToAnalyze);
        this.ctx.logger.info(`[DECISION] Flow Analysis: ${JSON.stringify(analysis)}`);

        // 3. 调用意愿计算器
        const willingness: Willingness = this.willingnessCalculator.calculate(analysis);
        this.ctx.logger.info(
            `[DECISION] Willingness Calculation: value=${willingness.value.toFixed(2)}, threshold=${willingness.threshold}, shouldAct=${
                willingness.shouldAct
            }`
        );
        this.ctx.logger.info(`[DECISION] Reasons: ${willingness.reasons.join("; ")}`);

        // 4. 根据最终决策行动
        if (willingness.shouldAct) {
            this.ctx.logger.info(`[ACTION] Willingness threshold met. Executing thinking cycle.`);
            await this.executeThinkingCycle(session, segmentToAnalyze, analysis, willingness);
        } else {
            this.ctx.logger.info(`[ACTION] Willingness threshold not met. Agent remains silent.`);
        }
    }

    /**
     * ReAct 思考-行动循环的核心控制器
     * @param segment 触发此循环的对话片段
     * @param analysis 对此片段的分析结果
     * @param willingness 触发此循环的意愿度计算结果
     */
    public async executeThinkingCycle(
        session: Session,
        segment: DialogueSegment,
        analysis: FlowAnalysis,
        willingness: Willingness
    ): Promise<void> {
        const channelId = segment.channelId;
        const platform = segment.platform;

        // 1. 创建一个新的 AgentTurn
        const agentTurnRecord = await this.ctx.database.create(TableName.AgentTurns, {
            id: `turn_${Date.now()}_${Random.id(8)}`,
            stimulusSegmentId: segment.id,
            channelId: channelId,
            platform: platform,
            status: "in_progress",
            startTimestamp: new Date(),
            endTimestamp: new Date(), // 临时值
        });

        let shouldContinueHeartbeat = true;
        let heartbeatCount = 0;
        const agentTurnHistory: AgentTurn[] = []; // 用于在循环中累积上下文

        // 2. 启动心跳循环 (Heartbeat Loop)
        while (shouldContinueHeartbeat && heartbeatCount < this.config.MaxHeartbeat) {
            heartbeatCount++;
            this.ctx.logger.info(`[THINK] ❤️ Heartbeat #${heartbeatCount} for turn ${agentTurnRecord.id}`);

            // a. 构建提示词
            const promptContext: PromptContext = await this.buildPromptContext(
                channelId,
                platform,
                segment,
                analysis,
                willingness,
                agentTurnHistory
            );
            const { system, user } = await this.promptBuilder.build(promptContext);

            // b. 调用 LLM
            const llmRawResponse = await this.adapterManager.executeWithAdapterSwitching(async (adapterName: string, model: ChatModel) => {
                return await this.retryManager.executeWithRetry(async (abortSignal: AbortSignal, cancelTimeout: () => void) => {
                    return await model.chat(
                        [
                            { role: "system", content: system },
                            { role: "user", content: user },
                        ],
                        {
                            debug: true,
                            logger: this.ctx.logger(model.id),
                            abortSignal,
                            onStreamStart: cancelTimeout, // 当流式响应开始时取消定时器
                        }
                    );
                }, adapterName);
            });

            const llmParsedResponse = this.parser.parse(llmRawResponse.text);

            if (llmParsedResponse.error || !llmParsedResponse.data) {
                this.ctx.logger.warn(`[THINK] Failed to parse LLM response: ${llmParsedResponse.error}`);
                this.ctx.logger.warn(`[THINK] Raw LLM Response: ${llmRawResponse}`);
                this.ctx.logger.warn(`[THINK] Reason: ${llmParsedResponse.logs}`);
                shouldContinueHeartbeat = false;
                continue;
            }

            const validResponse = llmParsedResponse.data;

            const context: ToolExecutionContext = {
                koishiContext: this.ctx,
                koishiSession: session,
                platform: this.ctx[Services.Platform],
                logger: this.ctx.logger("tool-exec"),
                extensionConfig: {},
            };

            // public async execute(action: Action, executionContext: ToolExecutionContext): Promise<ActionResult> {
            //     const { function: functionName, params } = action;

            //     const result = await this.toolService.executeToolCall(executionContext, functionName, params);
            //     return {
            //         function: functionName,
            //         result,
            //     };
            // }

            const execute = async (action: Action, context: ToolExecutionContext): Promise<ActionResult> => {
                const { function: functionName, params } = action;
                const result = await this.toolService.executeToolCall(context, functionName, params);
                return {
                    function: functionName,
                    result,
                };
            };

            // c. 执行工具调用
            const observations = await Promise.all(validResponse.actions.map((action) => execute(action, context)));

            // d. 记录 AgentResponse
            const agentResponse: AgentResponse = {
                thoughts: validResponse.thoughts,
                actions: validResponse.actions,
                observations: observations,
                request_heartbeat: validResponse.request_heartbeat,
            };
            await this.ctx.database.create(TableName.AgentResponses, {
                turnId: agentTurnRecord.id,
                ...agentResponse,
            });

            // e. 准备下一次循环
            agentTurnHistory.push({
                // 将本次的完整响应添加到历史中
                id: agentTurnRecord.id,
                platform: platform,
                channelId: channelId,
                stimulusSegmentId: segment.id,
                status: "in_progress",
                responses: [agentResponse],
                is_agent_turn: true,
                is_dialogue_segment: false,
            });
            shouldContinueHeartbeat = validResponse.request_heartbeat;
        }

        // 3. 结束循环并更新状态
        if (heartbeatCount >= this.config.MaxHeartbeat) {
            this.ctx.logger.warn(`[THINK] Max heartbeat reached for turn ${agentTurnRecord.id}.`);
        }

        await this.ctx.database.set(
            TableName.AgentTurns,
            { id: agentTurnRecord.id },
            {
                status: "completed",
                endTimestamp: new Date(),
            }
        );

        await this.ctx.database.set(
            TableName.DialogueSegments,
            { id: segment.id },
            {
                status: "closed_by_agent",
                endTimestamp: new Date(),
            }
        );

        this.ctx.logger.info(`[THINK] ✅ Turn ${agentTurnRecord.id} completed.`);
    }

    private async buildPromptContext(
        channelId: string,
        platform: string,
        segment: DialogueSegment,
        analysis: FlowAnalysis,
        willingness: Willingness,
        agentTurnHistory: AgentTurn[]
    ): Promise<PromptContext> {
        return {
            toolSchemas: this.toolService.getToolSchemas(),
            worldState: await this.worldState.getWorldState([channelId]),
            currentSegment: segment,
            agentState: {
                lifeCycleStatus: "active",
                analysis: analysis,
                willingness: willingness,
            },
            agentTurnHistory: agentTurnHistory,
        };
    }
}
