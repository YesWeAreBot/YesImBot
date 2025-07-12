import { Context, h, Logger, Random, Service, Session } from "koishi";
import type { ImagePart, Message, TextPart } from "xsai";
import {
    AgentResponse,
    DialogueSegment,
    IChatModel,
    ModelService,
    ModelSwitcher,
    Services,
    TaskType,
    ToolService,
    WorldState,
    WorldStateService,
} from "../services";
import { JsonParser, truncate } from "../shared";
import { AgentBehaviorConfig, ChannelDescriptor } from "./config";
import { PromptBuilder, PromptContext } from "./prompt-builder";
import { WillingnessManager } from "./willing";

declare module "koishi" {
    interface Events {
        "after-send": (session: Session) => void;
    }
}

type WithDispose<T> = T & { dispose: () => void };

export class AgentCore extends Service<AgentBehaviorConfig> {
    static readonly inject = [Services.WorldState, Services.Model, Services.Tool, Services.Memory, Services.Image, Services.Logger];

    // 依赖的服务
    private readonly worldState: WorldStateService;
    private readonly modelService: ModelService;
    private readonly toolService: ToolService;

    // 内部组件
    private readonly _logger: Logger;

    private readonly promptBuilder: PromptBuilder;
    private readonly parser: JsonParser<AgentResponse>;
    private readonly modelSwitcher: ModelSwitcher<IChatModel>;

    // 内部状态
    private readonly allowedChannels = new Set<string>();
    private readonly channelGroupMap = new Map<string, ChannelDescriptor[]>();
    private willingnessDecayTimer: NodeJS.Timeout;
    private readonly debouncedReplyTasks: Map<string, WithDispose<() => void>> = new Map();

    private runningTasks: Set<string> = new Set();

    private imageLifecycleTracker = new Map<string, number>();
    private willing: WillingnessManager;

    constructor(ctx: Context, config: AgentBehaviorConfig) {
        super(ctx, "agent", true);
        this.ctx = ctx;
        this.config = config;
        this._logger = ctx[Services.Logger].getLogger("[智能体核心]");

        this.worldState = this.ctx[Services.WorldState];
        this.modelService = this.ctx[Services.Model];
        this.toolService = this.ctx[Services.Tool];

        // 实例化内部组件
        this.promptBuilder = new PromptBuilder(this.ctx, this.config.prompt);
        this.parser = new JsonParser<AgentResponse>();
        this.modelSwitcher = this.modelService.useChatGroup(TaskType.Chat);
        this.willing = new WillingnessManager(this.ctx, this.config.willingness);
    }

    protected async start(): Promise<void> {
        this.updateAllowedChannels();
        this.ctx.on("config", () => this.updateAllowedChannels());

        this.ctx.on("worldstate:segment-updated", async (session, segment) => {
            const channelKey = session.cid;

            // --- 第1步: 意愿计算与决策 (无论如何都执行) ---
            // 这个阶段不应被任何锁阻止，以确保意愿可以持续更新。
            let decision = false;
            let probability = 0;
            try {
                const currentWillingnessBefore = this.willing.getCurrentWillingness(channelKey);
                // 调用 shouldReply 来计算和更新意愿值，并获得初步决策
                const result = this.willing.shouldReply(session);
                decision = result.decision;
                probability = result.probability;
                const currentWillingnessAfter = this.willing.getCurrentWillingness(channelKey);

                /* prettier-ignore */
                this._logger.debug(`[${channelKey}] 意愿计算: ${currentWillingnessBefore.toFixed(2)} -> ${currentWillingnessAfter.toFixed(2)} | 回复概率: ${(probability * 100).toFixed(1)}% | 初步决策: ${decision}`);
            } catch (error) {
                // 意愿计算阶段的错误也需要捕获
                this.handleError(error, `意愿计算失败 (Channel: ${channelKey})`);
                return; // 计算失败，直接退出
            }

            // --- 第2步: 检查决策并触发防抖任务 ---
            if (!decision) {
                // 如果决策为不回复，则流程到此结束。
                this._logger.debug(`[${channelKey}] 决策为不回复，任务终止。`);
                return;
            }

            // 从 Map 中获取或创建当前频道的防抖函数
            let debouncedTask = this.debouncedReplyTasks.get(channelKey);

            if (!debouncedTask) {
                // 如果该频道还没有对应的防杜函数，则创建一个
                // ctx.debounce 的回调函数包含了原先需要被保护的“第3步”逻辑
                debouncedTask = this.ctx.debounce(async () => {
                    // --- 第3步: 执行回复任务 (加锁 -> 执行 -> 解锁) ---
                    // 防抖成功后，这里的代码才会被执行
                    try {
                        // --- 加锁 ---
                        if (this.runningTasks.has(channelKey)) {
                            this._logger.warn(`[${channelKey}] 决策为回复，但发现已有任务在运行。本次执行被跳过。`);
                            return;
                        }
                        this.runningTasks.add(channelKey);
                        this._logger.debug(`[${channelKey}] 锁定频道并开始执行回复任务。`);

                        // 执行行动前钩子
                        this.willing.handlePreReply(channelKey);

                        // 核心循环
                        const success = await this.runAgentCycle(session, segment);

                        // 行动后钩子 (只在成功时调用)
                        if (success) {
                            const willingnessBeforeReply = this.willing.getCurrentWillingness(channelKey);
                            this.willing.handlePostReply(channelKey);
                            const willingnessAfterReply = this.willing.getCurrentWillingness(channelKey);
                            /* prettier-ignore */
                            this._logger.debug(`[${channelKey}] 回复成功，意愿值已更新: ${willingnessBeforeReply.toFixed(2)} -> ${willingnessAfterReply.toFixed(2)}`);
                        }

                        this._logger.debug(`[${channelKey}] 回复任务执行完毕。`);
                    } catch (error) {
                        // 捕获 runAgentCycle 或钩子函数中的任何错误
                        this.handleError(error, `执行回复任务时发生错误 (Channel: ${channelKey}, Segment ID: ${segment.id})`);
                    } finally {
                        // --- 解锁 ---
                        // 无论成功还是失败，都必须在 finally 块中释放锁
                        this.runningTasks.delete(channelKey);
                        this._logger.debug(`[${channelKey}] 频道锁已释放。`);
                    }
                }, this.config.arousal.debounceMs); // 使用定义的延迟

                // 将新创建的防抖函数存入 Map
                this.debouncedReplyTasks.set(channelKey, debouncedTask);
            }

            // 触发防抖流程
            // 每次调用都会重置计时器。只有当 DEBOUNCE_DELAY 毫秒内没有新的调用时，上面的回调才会执行。
            this._logger.debug(`[${channelKey}] 决策为回复，触发防抖机制（延迟 ${this.config.arousal.debounceMs}ms）。`);
            debouncedTask();
        });

        this.willing.startDecayCycle();

        this._logger.info("🚀 服务已启动");
    }

    protected stop(): void {
        this.debouncedReplyTasks.forEach((d) => d.dispose());
        clearInterval(this.willingnessDecayTimer);
        this.willing.stopDecayCycle();
        this._logger.info("🛑 服务已停止");
    }

    private updateAllowedChannels(): void {
        this.allowedChannels.clear();
        this.config.arousal.allowedChannelGroups.forEach((group) => {
            group.forEach(({ platform, id }) => {
                this.allowedChannels.add(`${platform}:${id}`);
            });
        });
        this._logger.debug(`⚙️ 监听频道已更新 | 总数: ${this.allowedChannels.size}`);
    }

    private async runAgentCycle(session: Session, segment: DialogueSegment): Promise<boolean> {
        this._logger.debug(`🌀 → 开始 | 段落ID: ${segment.id}`);
        const collectedResponses: AgentResponse[] = [];
        let shouldContinueHeartbeat = true;
        let heartbeatCount = 0;

        let success = false;

        while (shouldContinueHeartbeat && heartbeatCount < this.config.heartbeat) {
            heartbeatCount++;
            this._logger.debug(`❤️ #${heartbeatCount} | 段落ID: ${segment.id}`);

            try {
                const promptContext = await this.buildPromptContext(segment, collectedResponses);

                let multimodal = false;

                if (promptContext.multiModalData?.images) {
                    // this._logger.debug(`[${segment.id}] 多模态场景检测到 ${promptContext.multiModalData.images.length} 张图片。`);
                    multimodal = true;
                }

                // 寻找当前模型组中支持多模态的模型，如果找不到则渲染纯文本提示词

                let chatModel: IChatModel = this.modelSwitcher.current;

                if (multimodal) {
                    for (let i = 0; i < this.modelSwitcher.length; i++) {
                        if (chatModel.isVisionModel()) {
                            break;
                        }
                        this._logger.debug(`当前模型 ${chatModel.id} 不支持多模态，切换到下一个`);
                        chatModel = this.modelSwitcher.next();
                    }
                    if (!chatModel.isVisionModel()) {
                        this._logger.warn(`当前模型组中没有支持多模态的模型，跳过多模态处理`);
                        multimodal = false;
                        promptContext.multiModalData = { images: [] };
                    }
                }

                const { messages } = await this.promptBuilder.build(promptContext);

                if (!chatModel) {
                    this._logger.error(`✖ 模型未找到，停止回复 | 频道 - ${session.cid}`);
                    shouldContinueHeartbeat = false;
                    continue;
                }

                const stime = Date.now();

                // 创建一个 AbortController 用于取消请求
                const abortController = new AbortController();

                const timeout = setTimeout(() => {
                    abortController.abort();
                }, this.config.timeout * 1000);

                const onStreamStart = () => {
                    clearTimeout(timeout);
                    this._logger.debug(`🌊 流式传输已开始 | 频道 - ${session.cid}`);
                };

                const llmRawResponse = await chatModel.chat(messages, { abortSignal: abortController.signal, onStreamStart });

                this._logger.info(`💬 响应时间: ${Date.now() - stime}ms`);

                const { text, usage } = llmRawResponse;

                const getContentLength = (messages: Message[]): number => {
                    const parts = messages.flatMap((msg) => {
                        if (typeof msg.content === "string") {
                            return msg.content;
                        } else {
                            return msg.content.map((part) => part.text);
                        }
                    });

                    return parts.join("").length;
                };

                /* prettier-ignore */
                this._logger.info(`💰 Token 消耗 | 输入: ${usage?.prompt_tokens || `${getContentLength(messages)}字符`} | 输出: ${usage?.completion_tokens || `${text.length}字符`}`);

                const llmParsedResponse = this.parser.parse(text);

                if (llmParsedResponse.error || !llmParsedResponse.data) {
                    /* prettier-ignore */
                    this._logger.warn(`✖ 解析失败 | 错误: ${llmParsedResponse.error} | 原始响应: ${truncate(llmRawResponse.text, 100).replace(/\n/g, " ")}`);
                    shouldContinueHeartbeat = false;
                    success = false;
                    continue;
                }

                const agentResponseData = llmParsedResponse.data;

                // 验证响应格式
                if (!Array.isArray(agentResponseData.actions)) {
                    this._logger.warn(`✖ 格式无效 | actions应为数组，实际为 ${typeof agentResponseData.actions}`);
                    shouldContinueHeartbeat = false;
                    continue;
                }

                const thoughts: AgentResponse["thoughts"] = agentResponseData.thoughts;

                if (thoughts) {
                    this.displayThoughts(thoughts);
                }

                const observations = await this.executeActions(session, agentResponseData.actions);

                const fullResponse: AgentResponse = { ...agentResponseData, observations };
                collectedResponses.push(fullResponse);

                shouldContinueHeartbeat = agentResponseData.request_heartbeat;
            } catch (error) {
                this.handleError(error, `心跳 #${heartbeatCount} 期间 (段落ID: ${segment.id})`);
                shouldContinueHeartbeat = false;
                success = false;
            }
        }

        if (collectedResponses.length > 0) {
            this._logger.debug(`💾 正在保存 ${collectedResponses.length} 个响应 | 段落ID: ${segment.id}`);
            await this.worldState.recordAgentTurn(segment, collectedResponses);
            this._logger.debug(`✅ 完成 | 段落ID: ${segment.id}`);
            success = true;
        }

        return success;
    }

    private displayThoughts(thoughts: AgentResponse["thoughts"]) {
        const { observe, analyze_infer, plan } = thoughts;
        this._logger.info(`
[观察] ${observe}
[分析] ${analyze_infer}
[计划] ${plan}]`);
    }

    private async executeActions(session: Session, actions: AgentResponse["actions"]): Promise<AgentResponse["observations"]> {
        let observations: AgentResponse["observations"] = [];
        for await (const action of actions) {
            const result = await this.toolService.invoke(action.function, action.params, session);
            observations.push({ function: action.function, status: result.status, result: result.result, error: result.error });
        }
        return observations;
    }

    private async buildPromptContext(segment: DialogueSegment, previousResponses: AgentResponse[]): Promise<PromptContext> {
        const allowedChannels =
            this.channelGroupMap.get(segment.channelId) ||
            this.config.arousal.allowedChannelGroups.find((group) =>
                group.some((channel) => channel.platform === segment.platform && channel.id === segment.channelId)
            );
        if (allowedChannels && !this.channelGroupMap.has(segment.channelId)) {
            this.channelGroupMap.set(segment.channelId, allowedChannels);
        }

        const onetimeCode = Random.id(8);

        const worldState = await this.worldState.getWorldState(allowedChannels || [], onetimeCode);

        // 图片智能筛选与上下文构建
        const { images: multiModalContent } = this.config.vision.enabled ? await this.buildMultimodalContext(worldState) : { images: [] };

        // 在 worldState 中查找并标记当前 segment
        for (const channel of worldState.activeChannels) {
            const currentSegmentInHistory = channel.history.pending.find((s) => s.id === segment.id);
            if (currentSegmentInHistory) {
                (currentSegmentInHistory as any).is_current = true;
                break;
            }
        }

        return {
            toolSchemas: this.toolService.getToolSchemas(),
            memory: await this.ctx[Services.Memory].getMemoryDataForRendering(),
            worldState: worldState,
            previousResponses: previousResponses,
            multiModalData: {
                images: multiModalContent,
                // 传递处理后的纯文本历史
                // textualHistory: textualHistory,
            },
            onetimeCode,
        };
    }

    /**
     * 构建多模态上下文的核心方法
     * @param worldState 当前的世界状态
     * @returns 包含筛选后的图片内容和处理后的文本历史的对象
     */
    private async buildMultimodalContext(worldState: WorldState): Promise<{ images: (ImagePart | TextPart)[] }> {
        // 1. 扁平化所有消息，并建立索引
        const allMessages = worldState.activeChannels
            .flatMap((c) => [...c.history.pending, c.history.folded].filter(Boolean).map((s) => s.dialogue))
            .flat();
        allMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const messageMap = new Map(allMessages.map((m) => [m.id, m]));

        // 3. 智能筛选图片ID
        const finalImageIds = new Set<string>();

        // 遍历所有消息，优先添加被引用的图片
        for (const msg of allMessages) {
            if (msg.quoteId && messageMap.has(msg.quoteId)) {
                const quotedMsg = messageMap.get(msg.quoteId);
                const elements = h.parse(quotedMsg.content);
                const imageIds = elements.filter((e) => e.type === "image" && e.attrs.id).map((e) => e.attrs.id as string);
                for (const id of imageIds) {
                    if (finalImageIds.size < this.config.vision.maxImagesInContext) {
                        finalImageIds.add(id);
                        this.imageLifecycleTracker.set(id, (this.imageLifecycleTracker.get(id) || 0) + 1);
                    }
                }
            }
        }

        // 从最新消息开始向后遍历，添加常规图片，直到上限
        for (let i = allMessages.length - 1; i >= 0; i--) {
            if (finalImageIds.size >= this.config.vision.maxImagesInContext) break;
            const msg = allMessages[i];
            const elements = h.parse(msg.content);
            const imageIds = elements.filter((e) => e.type === "image" && e.attrs.id).map((e) => e.attrs.id as string);
            for (const id of imageIds) {
                // 检查生命周期和上限
                if ((this.imageLifecycleTracker.get(id) || 0) < this.config.vision.imageLifecycleCount) {
                    if (finalImageIds.size < this.config.vision.maxImagesInContext) {
                        finalImageIds.add(id);
                        this.imageLifecycleTracker.set(id, (this.imageLifecycleTracker.get(id) || 0) + 1);
                    }
                }
            }
        }

        // 4. 获取图片数据并生成带引用的文本历史
        const imageService = this.ctx[Services.Image];
        const imageFetchPromises = Array.from(finalImageIds).map((id) => imageService.getImageDataWithContent(id));
        const imageDataResults = await Promise.all(imageFetchPromises);

        const finalImages: (ImagePart | TextPart)[] = [];

        const allowedImageTypes = this.config.vision.allowedImageTypes;

        for (const result of imageDataResults) {
            if (result && allowedImageTypes.includes(result.data?.mimeType)) {
                finalImages.push({ type: "text", text: `Image #${result.data.id}:` });
                finalImages.push({ type: "image_url", image_url: { url: result.content, detail: this.config.vision.detail } });
            }
        }

        return { images: finalImages };
    }

    /**
     * 改进的错误处理器
     * @param error 捕获到的错误对象
     * @param contextDescription 发生错误的上下文描述
     */
    private handleError(error: any, contextDescription: string): void {
        // 检查 error 是否是 Error 实例，以便能访问堆栈
        if (error instanceof Error) {
            this._logger.error(`[错误] ${contextDescription}\n` + `错误信息: ${error.message}\n` + `堆栈追踪:\n${error.stack}`);
        } else {
            // 如果捕获到的不是标准Error对象（例如字符串或普通对象）
            this._logger.error(`[错误] ${contextDescription}\n` + `捕获到非标准错误: ${JSON.stringify(error)}`);
        }
    }
}
