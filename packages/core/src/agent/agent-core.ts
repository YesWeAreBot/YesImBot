import type { ImagePart, Message, TextPart } from "@xsai/shared-chat";
import { Context, h, Service, Session } from "koishi";

import { AssetService } from "@/services/assets";
import { Properties, ToolSchema, ToolService } from "@/services/extension";
import { MemoryBlockData } from "@/services/memory";
import { IChatModel, ModelService, ModelSwitcher, TaskType } from "@/services/model";
import { loadTemplate, PromptService } from "@/services/prompt";
import { AgentResponse, WorldState, WorldStateService, AgentStimulus, UserMessagePayload, PromptContext } from "@/services/worldstate";
import { Services } from "@/shared/constants";
import { AppError, ErrorCodes, handleError } from "@/shared/errors";
import { estimateTokensByRegex, JsonParser, truncate } from "@/shared/utils";
import { AgentBehaviorConfig } from "./config";
import { WillingnessManager } from "./willing";

declare module "koishi" {
    interface Events {
        "after-send": (session: Session) => void;
    }
}

type WithDispose<T> = T & { dispose: () => void };


// 用于多模态上下文筛选的内部类型
interface ImageCandidate {
    id: string;
    timestamp: number;
    priority: number;
}

export class AgentCore extends Service<AgentBehaviorConfig> {
    static readonly inject = [
        Services.Asset,
        Services.Logger,
        Services.Memory,
        Services.Model,
        Services.Prompt,
        Services.Tool,
        Services.WorldState,
    ];

    // 依赖的服务
    private readonly assetService: AssetService;
    private readonly modelService: ModelService;
    private readonly promptService: PromptService;
    private readonly toolService: ToolService;
    private readonly worldState: WorldStateService;

    // 内部组件
    private readonly parser: JsonParser<AgentResponse>;
    private readonly modelSwitcher: ModelSwitcher<IChatModel>;
    private readonly willing: WillingnessManager;

    // 内部状态_performSingleHeartbeat
    private readonly allowedChannels = new Set<string>();
    private willingnessDecayTimer: NodeJS.Timeout;
    private readonly debouncedReplyTasks: Map<string, WithDispose<(stimulus: AgentStimulus<any>) => void>> = new Map();

    private runningTasks: Set<string> = new Set();

    private imageLifecycleTracker = new Map<string, number>();

    // 新消息处理策略相关状态
    private skippedStimulus = new Map<string, AgentStimulus<any>>();
    private deferredTimers = new Map<string, NodeJS.Timeout>();

    constructor(ctx: Context, config: AgentBehaviorConfig) {
        super(ctx, "agent", true);
        this.ctx = ctx;
        this.config = config;
        this.logger = this.ctx[Services.Logger].getLogger("[智能体核心]");

        this.assetService = this.ctx[Services.Asset];
        this.modelService = this.ctx[Services.Model];
        this.promptService = this.ctx[Services.Prompt];
        this.toolService = this.ctx[Services.Tool];
        this.worldState = this.ctx[Services.WorldState];

        // 实例化内部组件
        this.parser = new JsonParser<AgentResponse>();
        this.modelSwitcher = this.modelService.useChatGroup(TaskType.Chat);
        this.willing = new WillingnessManager(this.ctx, this.config.willingness);

        if (!this.modelSwitcher) {
            const error = new AppError("未配置模型组，智能体核心无法启动", {
                code: ErrorCodes.CONFIG.MISSING,
                context: { service: "AgentCore", component: "modelSwitcher" },
            });
            handleError(this.logger, error, "智能体核心启动失败");
        }
    }

    protected async start(): Promise<void> {
        this._registerPromptTemplates();
        this.updateAllowedChannels();
        this.ctx.on("config", () => this.updateAllowedChannels());

        this.ctx.on("agent/stimulus", async (stimulus: AgentStimulus<any>) => {
            const { type, channelCid: channelKey, session, payload } = stimulus;

            // --- 第1步: 意愿计算与决策 ---
            let decision = false;
            if (type === "user_message") {
                // 只有用户消息需要经过复杂的意愿计算
                try {
                    const currentWillingnessBefore = this.willing.getCurrentWillingness(channelKey);
                    const result = this.willing.shouldReply(session);
                    decision = result.decision;
                    const probability = result.probability;
                    const currentWillingnessAfter = this.willing.getCurrentWillingness(channelKey);
                    /* prettier-ignore */
                    this.logger.debug(`[${channelKey}] 意愿计算: ${currentWillingnessBefore.toFixed(2)} -> ${currentWillingnessAfter.toFixed(2)} | 回复概率: ${(probability * 100).toFixed(1)}% | 初步决策: ${decision}`);
                } catch (error) {
                    handleError(this.logger, error, `意愿计算失败 (Channel: ${channelKey})`);
                    return;
                }
            } else {
                // 对于高优先级事件，直接决定回复
                decision = true;
                this.logger.info(`[${channelKey}] 接收到 [${type}] 刺激，直接触发响应`);
            }

            // --- 第2步: 检查决策并触发防抖任务 ---
            if (!decision) {
                return;
            }

            // --- 禁言检查 ---
            if (this.worldState.isBotMuted(channelKey)) {
                this.logger.warn(`[${channelKey}] 机器人已被禁言，无法发送消息。响应流程终止`);
                return;
            }

            if (this.runningTasks.has(channelKey)) {
                this.logger.warn(`[${channelKey}] 决策为回复，但发现已有任务在运行。本次执行将根据策略处理`);
                if (type === "user_message") {
                    this.handleBusyChannel(session, stimulus, channelKey);
                }
                return;
            }

            let debouncedTask = this.debouncedReplyTasks.get(channelKey);

            if (!debouncedTask) {
                debouncedTask = this.ctx.debounce(async (stimulus: AgentStimulus<any>) => {
                    // --- 第3步: 执行回复任务 (加锁 -> 执行 -> 解锁) ---
                    try {
                        this.runningTasks.add(channelKey);
                        this.logger.debug(`[${channelKey}] 锁定频道并开始执行回复任务`);

                        this.willing.handlePreReply(channelKey);

                        const success = await this.runAgentCycle(stimulus);

                        if (success) {
                            const willingnessBeforeReply = this.willing.getCurrentWillingness(channelKey);
                            this.willing.handlePostReply(channelKey);
                            const willingnessAfterReply = this.willing.getCurrentWillingness(channelKey);
                            /* prettier-ignore */
                            this.logger.debug(`[${channelKey}] 回复成功，意愿值已更新: ${willingnessBeforeReply.toFixed(2)} -> ${willingnessAfterReply.toFixed(2)}`);
                        }
                    } catch (error) {
                        /* prettier-ignore */
                        handleError(this.logger, error, `执行回复任务时发生错误 (Channel: ${channelKey})`);
                    } finally {
                        this.runningTasks.delete(channelKey);
                        this.logger.debug(`[${channelKey}] 频道锁已释放`);
                        this.handleSkippedMessagesAfterReply(channelKey);
                    }
                }, this.config.arousal.debounceMs);

                this.debouncedReplyTasks.set(channelKey, debouncedTask);
            }

            /* prettier-ignore */
            this.logger.debug(`[${channelKey}] 决策为回复，触发防抖机制（延迟 ${this.config.arousal.debounceMs}ms）`);
            debouncedTask(stimulus);
        });

        this.willing.startDecayCycle();

        this.logger.info("服务已启动");
    }

    protected stop(): void {
        this.debouncedReplyTasks.forEach((d) => d.dispose());
        clearInterval(this.willingnessDecayTimer);
        this.willing.stopDecayCycle();

        // 清理延迟处理定时器
        this.deferredTimers.forEach((timer) => clearTimeout(timer));
        this.deferredTimers.clear();

        // 清理跳过消息记录
        this.skippedStimulus.clear();

        this.logger.info("服务已停止");
    }

    private updateAllowedChannels(): void {
        this.allowedChannels.clear();
        this.config.arousal.allowedChannelGroups.forEach((group) => {
            group.forEach(({ platform, id }) => {
                this.allowedChannels.add(`${platform}:${id}`);
            });
        });
        // this.logger.debug(`⚙⚙️ 监听频道已更新 | 总数: ${this.allowedChannels.size}`);
    }

    private _registerPromptTemplates(): void {
        // this.logger.info("正在注册提示词模板");

        // 注册所有可重用的局部模板 (Partials)
        // 使用 Mustache 的 {{> partialName }} 语法来引用它们
        this.promptService.registerTemplate("agent.partial.memory_block", loadTemplate("memory/block"));
        this.promptService.registerTemplate("agent.partial.tool_definition", loadTemplate("tool_definition"));
        this.promptService.registerTemplate("agent.partial.world_state", loadTemplate("world_state"));
        this.promptService.registerTemplate("agent.partial.current_turn_history", loadTemplate("current_turn_history"));

        // 注册主模板
        // 注意：现在模板文件本身需要包含对 partials 的引用
        this.promptService.registerTemplate("agent.system", this.config.prompt.systemTemplate);
        this.promptService.registerTemplate("agent.user", this.config.prompt.userTemplate);

        // 注册动态片段 (Snippets) - 如果有的话
        // 示例：注册一个提供当前时间的片段
        this.promptService.registerSnippet("agent.context.currentTime", () => new Date().toISOString());

        // 注意：像 toolSchemas, memory, worldState 这些数据，因为每次调用都会重新生成，
        // 所以更适合作为 render 方法的 initialScope 传入，而不是注册为全局 Snippet。
        // 这使得每次渲染的上下文都是隔离和最新的。

        // this.logger.info("✅ 提示词模板注册完成。");
    }

    /**
     * 处理频道正忙时的消息
     */
    private handleBusyChannel(session: Session, stimulus: AgentStimulus<any>, channelKey: string) {
        const strategy = this.config.newMessageStrategy;
        this.logger.debug(`[${channelKey}] 频道正忙，采用策略: ${strategy}`);

        switch (strategy) {
            case "immediate":
                // 策略2：记录被跳过的刺激，待当前任务完成后立即处理
                this.skippedStimulus.set(channelKey, stimulus);
                this.logger.debug(`[${channelKey}] 消息已记录，将在当前任务完成后立即处理`);
                break;

            case "deferred":
                // 策略3：记录被跳过的刺激，设置延迟处理定时器
                this.skippedStimulus.set(channelKey, stimulus);
                this.logger.debug(`[${channelKey}] 消息已记录，将在任务完成后开始延迟计时`);
                break;

            case "skip":
            default:
                // 策略1：直接跳过（默认行为）
                this.logger.debug(`[${channelKey}] 跳过处理（策略: skip）`);
                break;
        }
    }

    /**
     * 设置延迟处理定时器（策略3）
     */
    private setupDeferredTimer(channelKey: string) {
        // 清除现有定时器
        if (this.deferredTimers.has(channelKey)) {
            clearTimeout(this.deferredTimers.get(channelKey));
            this.deferredTimers.delete(channelKey);
        }

        const timer = setTimeout(() => {
            this.logger.debug(`[${channelKey}] 延迟处理定时器触发`);
            if (this.skippedStimulus.has(channelKey)) {
                const stimulus = this.skippedStimulus.get(channelKey);
                this.skippedStimulus.delete(channelKey);

                // 添加引导提示
                this.guideToSkippedTopic(channelKey);

                // 获取防抖任务并执行
                const debouncedTask = this.debouncedReplyTasks.get(channelKey);
                if (debouncedTask) {
                    this.logger.debug(`[${channelKey}] 处理被跳过的段落`);
                    debouncedTask(stimulus);
                }
            }
            this.deferredTimers.delete(channelKey);
        }, this.config.deferredProcessingTime || 10000);

        this.deferredTimers.set(channelKey, timer);
        this.logger.debug(`[${channelKey}] 延迟定时器启动，等待 ${this.config.deferredProcessingTime}ms`);
    }

    /**
     * 引导模型关注被跳过的话题（策略3）
     */
    private async guideToSkippedTopic(channelKey: string): Promise<void> {
        // 提高意愿值
        this.willing.boostSkippedTopic(channelKey);

        // 在世界状态中添加提示
        await this.worldState.guideToSkippedTopic(channelKey);

        this.logger.debug(`[${channelKey}] 已添加话题引导提示`);
    }

    /**
     * 当前任务完成后处理被跳过的消息（策略2 & 3）
     */
    private handleSkippedMessagesAfterReply(channelKey: string) {
        if (this.config.newMessageStrategy === "immediate" && this.skippedStimulus.has(channelKey)) {
            const skippedStimulus = this.skippedStimulus.get(channelKey);
            this.skippedStimulus.delete(channelKey);

            // 清除策略3的定时器（如果有）
            if (this.deferredTimers.has(channelKey)) {
                clearTimeout(this.deferredTimers.get(channelKey));
                this.deferredTimers.delete(channelKey);
            }

            this.logger.debug(`[${channelKey}] 立即处理被跳过的段落`);
            const debouncedTask = this.debouncedReplyTasks.get(channelKey);
            if (debouncedTask) {
                debouncedTask(skippedStimulus);
            }
        } else if (this.config.newMessageStrategy === "deferred" && this.skippedStimulus.has(channelKey)) {
            // 任务完成后才启动定时器
            this.setupDeferredTimer(channelKey);
        }
    }

    /**
     * Agent 的核心心跳循环。现在只负责控制循环流程。
     */
    private async runAgentCycle(stimulus: AgentStimulus<any>): Promise<boolean> {
        const collectedResponses: AgentResponse[] = [];
        let shouldContinueHeartbeat = true;
        let heartbeatCount = 0;
        let success = false;
        const sid = stimulus.type === "user_message" ? (stimulus.payload as UserMessagePayload).sid : null;

        while (shouldContinueHeartbeat && heartbeatCount < this.config.heartbeat) {
            heartbeatCount++;
            try {
                const result = await this._performSingleHeartbeat(stimulus, collectedResponses);
                if (result) {
                    collectedResponses.push(result.response);
                    shouldContinueHeartbeat = result.continue;
                    success = true; // 至少成功一次心跳
                } else {
                    shouldContinueHeartbeat = false;
                }
            } catch (error) {
                handleError(this.logger, error, `心跳 #${heartbeatCount} 期间 (刺激类型: ${stimulus.type})`);
                shouldContinueHeartbeat = false;
                success = false; // 出错则认为本次循环失败
            }
        }

        if (collectedResponses.length > 0 && sid) {
            await this.worldState.recordAgentTurn(sid, collectedResponses);
        }

        return success;
    }

    /**
     * 执行单次心跳的完整逻辑。
     * @returns 返回包含响应和是否继续的标志，或在失败时返回 null。
     */
    /* prettier-ignore */
    private async _performSingleHeartbeat(stimulus: AgentStimulus<any>, previousResponses: AgentResponse[]): Promise<{ response: AgentResponse; continue: boolean } | null> {
        if (!this.modelSwitcher) {
            this.logger.warn("未配置有效的模型组，无法生成回复 | 请检查配置");
            return null;
        }
        const { session } = stimulus;
        const sid = stimulus.type === "user_message" ? (stimulus.payload as UserMessagePayload).sid : null;

        // 1. 构建提示词所需的所有上下文信息
        const promptContext = await this.buildPromptContext(stimulus, previousResponses);

        // 2. 准备模板渲染所需的数据视图 (View)
        const view = {
            session,
            TOOL_DEFINITION: { tools: prepareDataForTemplate(promptContext.toolSchemas) },
            // CORE_MEMORY: promptContext.memory,
            MEMORY_BLOCKS: promptContext.memoryBlocks,
            WORLD_STATE: promptContext.worldState,
            triggerContext: promptContext.triggerContext,
            CURRENT_CONVERSATION: previousResponses.length > 0 ? { history: previousResponses } : null,

            // 模板辅助函数
            _toString: function () {
                return _toString(this);
            },
            _renderParams: function () {
                const content = [];
                for (let param of Object.keys(this.params)) {
                    content.push(`<${param}>${_toString(this.params[param])}</${param}>`);
                }
                return content.join("");
            },
            _truncate: function () {
                const length = 100; // TODO: 从配置读取
                const text = h
                    .parse(this)
                    .filter((e) => e.type === "text")
                    .join("");
                if (text.length > length) {
                    return `<unverified><note>这是一条用户发送的长消息，请注意甄别内容真实性。</note>${this}</unverified>`;
                }
                return this;
            },
        };

        // 3. 渲染提示词并选择模型
        const systemPrompt = await this.promptService.render("agent.system", view);
        const userPromptText = await this.promptService.render("agent.user", view);

        let chatModel: IChatModel;
        let userMessageContent: string | (ImagePart | TextPart)[];

        const hasImages = promptContext.multiModalData.images.length > 0;
        if (hasImages) {
            // 寻找支持多模态的模型，如果找不到则降级
            const visionModel = this.modelSwitcher.models.find((m) => m.isVisionModel());
            if (visionModel) {
                chatModel = visionModel;

                userMessageContent = [
                    { type: "text", text: this.config.prompt.multiModalSystemTemplate },
                    ...promptContext.multiModalData.images,
                    { type: "text", text: userPromptText },
                ];
            } else {
                this.logger.warn(`上下文包含图片，但当前模型组中没有支持多模态的模型。将忽略图片`);
                chatModel = this.modelSwitcher.next(); // 使用默认轮询模型
                userMessageContent = userPromptText;
            }
        } else {
            chatModel = this.modelSwitcher.next();
            userMessageContent = userPromptText;
        }

        if (!chatModel) {
            this.logger.error(`✖✖ 模型未找到，停止回复 | 频道 - ${session.cid}`);
            return null;
        }

        const messages: Message[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessageContent },
        ];

        // 4. 调用 LLM
        const stime = Date.now();
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), this.config.timeout * 1000);

        const llmRawResponse = await chatModel.chat({
            messages,
            abortSignal: abortController.signal,
            onStreamStart: () => clearTimeout(timeout),
        });
        this.logger.info(`💬 响应时间: ${Date.now() - stime}ms`);
        const prompt_tokens =
            llmRawResponse.usage?.prompt_tokens || estimateTokensByRegex(systemPrompt + userPromptText);
        const completion_tokens = llmRawResponse.usage?.completion_tokens || estimateTokensByRegex(llmRawResponse.text);
        /* prettier-ignore */
        this.logger.info(`💰 Token 消耗 | 输入: ${prompt_tokens} | 输出: ${completion_tokens} | 平均: ${Math.round((prompt_tokens+completion_tokens)/(Date.now()-stime)*1000)} t/s`);

        // 5. 解析和处理响应

        // A. 预先创建用于错误上报的上下文对象，避免重复
        const errorContext = {
            rawResponse: llmRawResponse.text,
            channelId: session.cid,
            segmentId: sid,
            modelUsed: chatModel.id,
            promptTokens: llmRawResponse.usage?.prompt_tokens,
            completionTokens: llmRawResponse.usage?.completion_tokens,
        };

        const llmParsedResponse = this.parser.parse(llmRawResponse.text);

        // B. 处理JSON解析失败
        if (llmParsedResponse.error || !llmParsedResponse.data) {
            const parseError = new AppError("解析 LLM 响应失败", {
                code: ErrorCodes.LLM.OUTPUT_PARSING_FAILED,
                // cause: llmParsedResponse.error,
                context: errorContext,
            });
            handleError(this.logger, parseError, `解析 LLM 响应时 (Channel: ${session.cid})`);
            return null;
        }

        const agentResponseData = llmParsedResponse.data;

        if (!agentResponseData.thoughts || typeof agentResponseData.thoughts !== "object") {
            const formatError = new AppError("LLM 响应格式无效：缺少必需的 'thoughts' 对象", {
                code: ErrorCodes.LLM.OUTPUT_PARSING_FAILED,
                context: errorContext,
            });
            handleError(this.logger, formatError, `验证 LLM 响应格式时 (Channel: ${session.cid})`);
            return null;
        }

        // D. (新) 处理 'actions' 字段格式无效
        if (!Array.isArray(agentResponseData.actions)) {
            const formatError = new AppError("LLM 响应格式无效：'actions' 字段不是一个数组", {
                code: ErrorCodes.LLM.OUTPUT_PARSING_FAILED,
                context: errorContext,
            });
            handleError(this.logger, formatError, `验证 LLM 响应格式时 (Channel: ${session.cid})`);
            return null;
        }

        if (agentResponseData.thoughts) {
            this.displayThoughts(agentResponseData.thoughts);
        }

        this.logger.debug("心跳：" + agentResponseData.request_heartbeat);
        const observations = await this.executeActions(session, agentResponseData.actions);
        const fullResponse: AgentResponse = { ...agentResponseData, observations };

        return { response: fullResponse, continue: agentResponseData.request_heartbeat };
    }

    private displayThoughts(thoughts: AgentResponse["thoughts"]) {
        if (!thoughts) return;
        const { observe, analyze_infer, plan } = thoughts;
        this.logger.info(`
[观察] ${observe}
[分析] ${analyze_infer}
[计划] ${plan}`);
    }

    private async executeActions(
        session: Session,
        actions: AgentResponse["actions"]
    ): Promise<AgentResponse["observations"]> {
        const observations: AgentResponse["observations"] = [];
        for await (const action of actions) {
            const result = await this.toolService.invoke(action.function, action.params, session);
            observations.push({
                function: action.function,
                status: result.status,
                result: result.result,
                error: result.error,
            });
        }
        return observations;
    }

    /* prettier-ignore */
    private async buildPromptContext(stimulus: AgentStimulus<any>, previousResponses: AgentResponse[]): Promise<PromptContext> {
        // 1. 获取世界状态和触发上下文
        const { worldState, triggerContext } = await this.worldState.buildContextForStimulus(stimulus);

        // 2. 获取多模态上下文（如果启用）
        const multiModalContent = this.config.vision.enabled
            ? await this.buildMultimodalContext(worldState)
            : { images: [] };

        // 3. 聚合所有数据
        return {
            triggerContext,
            toolSchemas: this.toolService.getToolSchemas(),
            memoryBlocks: await this.ctx[Services.Memory].getMemoryBlocksForRendering(),
            worldState: worldState,
            previousResponses: previousResponses,
            multiModalData: {
                images: multiModalContent.images,
            },
        };
    }

    /**
     * @description 构建多模态上下文。
     * 采用更声明式的方法来智能筛选图片，提高可读性和可维护性。
     * @param worldState 当前的世界状态
     * @returns 包含筛选后的图片内容的对象
     */
    private async buildMultimodalContext(worldState: WorldState): Promise<{ images: (ImagePart | TextPart)[] }> {
        // 1. 将所有消息扁平化并建立索引
        const allSegments = [
            worldState.channel.history.pending,
            ...(worldState.channel.history.closed || []),
            ...(worldState.channel.history.folded ? [worldState.channel.history.folded] : []),
        ].filter(Boolean); // 过滤掉可能为null的项

        const allMessages = allSegments.flatMap((s) => s.dialogue);
        const messageMap = new Map(allMessages.map((m) => [m.id, m]));

        const imageTags = ["img", "image"];

        // 2. 收集所有潜在的图片候选者，并赋予优先级
        const imageCandidates = allMessages.flatMap((msg) => {
            const elements = h.parse(msg.content);
            const imageIds = elements.filter((e) => imageTags.includes(e.type)  && e.attrs.id).map((e) => e.attrs.id as string);

            // 检查引用，为被引用的图片赋予更高优先级
            let isQuotedImage = false;
            if (msg.quoteId && messageMap.has(msg.quoteId)) {
                const quotedElements = h.parse(messageMap.get(msg.quoteId).content);
                if (quotedElements.some((e) => imageTags.includes(e.type))) {
                    isQuotedImage = true;
                }
            }

            return imageIds.map((id) => ({
                id,
                timestamp: msg.timestamp.getTime(),
                priority: isQuotedImage ? 1 : 0, // 1 for quoted, 0 for regular
            }));
        });

        // 3. 对候选图片进行排序：优先级更高 -> 时间戳更新 -> 去重和筛选
        const sortedUniqueCandidates = Array.from(
            imageCandidates
                .sort((a, b) => b.priority - a.priority || b.timestamp - a.timestamp)
                .reduce((map, candidate) => {
                    // 保留每个ID最高优先级的候选项
                    if (!map.has(candidate.id)) {
                        map.set(candidate.id, candidate);
                    }
                    return map;
                }, new Map<string, ImageCandidate>())
                .values()
        );

        // 4. 根据生命周期和数量上限选择最终图片
        const finalImageIds = new Set<string>();
        for (const candidate of sortedUniqueCandidates) {
            if (finalImageIds.size >= this.config.vision.maxImagesInContext) break;

            const usageCount = this.imageLifecycleTracker.get(candidate.id) || 0;
            if (usageCount < this.config.vision.imageLifecycleCount) {
                finalImageIds.add(candidate.id);
                this.imageLifecycleTracker.set(candidate.id, usageCount + 1);
            }
        }

        // 5. 获取图片数据并格式化输出
        if (finalImageIds.size === 0) {
            return { images: [] };
        }

        const imageDataResults = await Promise.all(
            Array.from(finalImageIds).map((id) => this.assetService.getAssetDataWithContent(id))
        );

        const finalImages: (ImagePart | TextPart)[] = [];
        const allowedImageTypes = new Set(this.config.vision.allowedImageTypes);

        for (const result of imageDataResults) {
            if (result && result.data && allowedImageTypes.has(result.data.mime)) {
                // 为LLM提供更明确的图片标识
                finalImages.push({ type: "text", text: `The following is an image with ID #${result.data.id}:` });
                finalImages.push({
                    type: "image_url",
                    image_url: { url: result.content, detail: this.config.vision.detail },
                });
            }
        }

        return { images: finalImages };
    }
}

function _toString(obj) {
    if (typeof obj === "string") return obj;
    return JSON.stringify(obj);
}

/**
 * @description 为 Mustache 模板准备工具数据。
 * 这个函数将扁平的工具定义转换为模板引擎易于遍历的嵌套结构。
 * 它通过递归为参数添加缩进，并处理嵌套对象和数组。
 */
function prepareDataForTemplate(tools: ToolSchema[]) {
    // 递归函数，处理参数并添加缩进
    const processParams = (params: Properties, indent = ""): any[] => {
        return Object.entries(params).map(([key, param]) => {
            const processedParam: any = {
                ...param,
                key: key,
                indent: indent,
            };

            // 如果是对象，递归处理其属性
            if (param.properties) {
                processedParam.properties = processParams(param.properties, indent + "    ");
            }

            // 如果是数组且数组成员是复杂对象，递归处理
            if (param.items) {
                // 将单个 item 包装成数组，以便局部模板可以统一处理
                processedParam.items = [
                    {
                        ...param.items,
                        key: "item", // 为数组项提供一个通用名称
                        indent: indent + "    ",
                        // 递归处理数组项的属性（如果它是一个对象）
                        ...(param.items.properties && {
                            properties: processParams(param.items.properties, indent + "        "),
                        }),
                    },
                ];
            }
            return processedParam;
        });
    };

    // 转换每个工具的参数
    return tools.map((tool) => ({
        ...tool,
        parameters: tool.parameters ? processParams(tool.parameters) : [],
    }));
}
