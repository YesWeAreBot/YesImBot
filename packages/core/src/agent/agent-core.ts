import { Bot, Context, h, Logger, Random, Schema, Service, Session, sleep } from "koishi";
import type { ImagePart, TextPart } from "xsai";
import {
    AgentResponse,
    createTool,
    DialogueSegment,
    Failed,
    IChatModel,
    ModelService,
    ModelSwitcher,
    Services,
    Success,
    TaskType,
    ToolDefinition,
    ToolExecutionContext,
    ToolService,
    WorldState,
    WorldStateService,
} from "../services";
import { JsonParser, truncate } from "../shared";
import { AgentBehaviorConfig, ChannelDescriptor } from "./config";
import { PromptBuilder, PromptContext } from "./prompt-builder";

declare module "koishi" {
    interface Events {
        "after-send": (session: Session) => void;
    }
}

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
    private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

    private runningTask = new Map<string, boolean>();

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
    }

    protected async start(): Promise<void> {
        this.updateAllowedChannels();
        this.ctx.on("config", () => this.updateAllowedChannels());

        this.ctx.on("worldstate:segment-updated", async (session, segment) => {
            if (this.runningTask.has(session.cid)) return;

            try {
                // 从 worldstate 接收到的消息即为过滤后的，在回复列表中
                // if (!this.isChannelAllowed(segment.platform, segment.channelId)) return;
                this.runningTask.set(session.cid, true);
                await this.handleSegmentUpdate(session, segment);
            } catch (error) {
                this.handleError(error, `处理段落更新时 (ID: ${segment.id})`);
            } finally {
                this.runningTask.delete(session.cid);
            }
        });

        this.toolService.registerTool(await this.createMessageTool());
        this._logger.info("[核心] 🚀 服务已启动");
    }

    protected stop(): void {
        this.debounceTimers.forEach(clearTimeout);
        clearInterval(this.willingnessDecayTimer);
        this._logger.info("[核心] 🛑 服务已停止");
    }

    private updateAllowedChannels(): void {
        this.allowedChannels.clear();
        this.config.arousal.allowedChannelGroups.forEach((group) => {
            group.forEach(({ platform, id }) => {
                this.allowedChannels.add(`${platform}:${id}`);
            });
        });
        this._logger.debug(`[配置] ⚙️ 监听频道已更新 | 总数: ${this.allowedChannels.size}`);
    }

    private async handleSegmentUpdate(session: Session, segment: DialogueSegment): Promise<void> {
        const channelKey = `${segment.platform}:${segment.channelId}`;
        this._logger.debug(`[决策] 🤔 开始评估 | 频道: ${channelKey}, 段落ID: ${segment.id}`);

        try {
            // 1. 调用意愿管理器进行决策

            // if (willingness.shouldAct) {
            const shouldAct = session.stripped.atSelf || session.isDirect;

            if (shouldAct) {
                // 2. 执行行动前后钩子和核心循环
                // this.willingnessManager.beforeAct(segment.channelId);
                await this.runAgentCycle(session, segment);
                // this.willingnessManager.afterAct(segment.channelId);
            }
        } catch (error) {
            this.handleError(error, `决策过程中 (段落ID: ${segment.id})`);
        }
    }

    private async runAgentCycle(session: Session, segment: DialogueSegment): Promise<void> {
        this._logger.debug(`[循环] 🌀 → 开始 | 段落ID: ${segment.id}`);
        const collectedResponses: AgentResponse[] = [];
        let shouldContinueHeartbeat = true;
        let heartbeatCount = 0;

        while (shouldContinueHeartbeat && heartbeatCount < this.config.heartbeat) {
            heartbeatCount++;
            this._logger.debug(`[心跳] ❤️ #${heartbeatCount} | 段落ID: ${segment.id}`);

            try {
                const promptContext = await this.buildPromptContext(segment, collectedResponses);
                const { messages } = await this.promptBuilder.build(promptContext);

                const chatModel = this.modelSwitcher.getCurrent();

                if (!chatModel) {
                    this._logger.error(`[心跳] ✖ 模型未找到，停止回复 | 段落ID: ${segment.id}`);
                    shouldContinueHeartbeat = false;
                    continue;
                }

                const stime = Date.now();

                const llmRawResponse = await chatModel.chat(messages);

                this._logger.info(`[心跳] 💬 响应时间: ${Date.now() - stime}ms | 段落ID: ${segment.id}`);

                const { text, usage } = llmRawResponse;

                this._logger.info(
                    `[心跳] 💰 Token 消耗 | 输入: ${usage?.prompt_tokens || "N/A"} | 输出: ${usage?.completion_tokens || "N/A"}`
                );

                const llmParsedResponse = this.parser.parse(text);

                if (llmParsedResponse.error || !llmParsedResponse.data) {
                    this._logger.warn(
                        `[心跳] ✖ 解析失败 | 错误: ${llmParsedResponse.error} | 原始响应: ${truncate(llmRawResponse.text, 100)}`
                    );
                    shouldContinueHeartbeat = false;
                    continue;
                }

                const agentResponseData = llmParsedResponse.data;

                // 验证响应格式
                if (!Array.isArray(agentResponseData.actions)) {
                    this._logger.warn(`[心跳] ✖ 格式无效 | actions应为数组，实际为 ${typeof agentResponseData.actions}`);
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
            }
        }

        if (collectedResponses.length > 0) {
            this._logger.debug(`[循环] 💾 正在保存 ${collectedResponses.length} 个响应 | 段落ID: ${segment.id}`);
            await this.worldState.recordAgentTurn(segment, collectedResponses);
            this._logger.debug(`[循环] ✅ 完成 | 段落ID: ${segment.id}`);
        } else {
            this._logger.warn(`[循环] ⚠️ 完成 (无行动) | 段落ID: ${segment.id}`);
        }

        if (heartbeatCount >= this.config.heartbeat) {
            this._logger.warn(`[循环] ⚠️ 已达最大心跳次数 | 段落ID: ${segment.id}`);
        }
    }

    private displayThoughts(thoughts: AgentResponse["thoughts"]) {
        const { observe, analyze_infer, plan } = thoughts;
        this._logger.debug(`[观察] ${observe}`);
        this._logger.debug(`[分析] ${analyze_infer}`);
        this._logger.debug(`[计划] ${plan}`);
    }

    private async executeActions(session: Session, actions: AgentResponse["actions"]): Promise<AgentResponse["observations"]> {
        const context: ToolExecutionContext = {
            koishiContext: this.ctx,
            koishiSession: session,
            logger: this.ctx[Services.Logger].getLogger("tool-exec"),
            extensionConfig: {},
        };

        return Promise.all(
            actions.map(async (action) => {
                const result = await this.toolService.executeToolCall(context, action.function, action.params);
                return { function: action.function, status: result.status, result: result.result, error: result.error };
            })
        );
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
            const currentSegmentInHistory = channel.history.find((s) => s.id === segment.id);
            if (currentSegmentInHistory) {
                (currentSegmentInHistory as any).is_current = true;
                break;
            }
        }

        return {
            toolSchemas: this.toolService.getToolSchemas(),
            memory: await this.ctx[Services.Memory].getProvider(),
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
        const allMessages = worldState.activeChannels.flatMap((c) => c.history.flatMap((s) => s.dialogue));
        allMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const messageMap = new Map(allMessages.map((m) => [m.id, m]));

        // 2. 计算图片生命周期
        const imageLifecycleTracker = new Map<string, number>();
        for (const seg of worldState.activeChannels.flatMap((c) => c.history)) {
            if (seg.agentTurn) {
                // 只在 Agent 实际响应过的回合计算
                for (const msg of seg.dialogue) {
                    const elements = h.parse(msg.content);
                    const imageIds = elements.filter((e) => e.type === "image" && e.attrs.id).map((e) => e.attrs.id as string);
                    for (const id of imageIds) {
                        imageLifecycleTracker.set(id, (imageLifecycleTracker.get(id) || 0) + 1);
                    }
                }
            }
        }

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
                if ((imageLifecycleTracker.get(id) || 0) < this.config.vision.imageLifecycleCount) {
                    if (finalImageIds.size < this.config.vision.maxImagesInContext) {
                        finalImageIds.add(id);
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

    private handleError(error: unknown, context: string): void {
        if (error instanceof Error) {
            this._logger.error(`[错误] 💥 在 ${context} 发生错误 | 信息: ${error.message}\n${error.stack}`);
        } else {
            this._logger.error(`[错误] 💥 在 ${context} 发生未知错误:`, error);
        }
    }

    private async createMessageTool(): Promise<ToolDefinition> {
        return createTool({
            name: "send_message",
            description: "Sends a message to a user or channel, mimicking human-like behavior.",
            parameters: Schema.object({
                inner_thoughts: Schema.string().description("Your internal monologue for self-reflection. This content will not be sent."),
                message: Schema.string().description(
                    "The message content to send. Use `<sep/>` to split a long response into multiple, shorter messages, which will be sent with natural delays. E.g., 'Hello there<sep/>How are you?'"
                ),
                target: Schema.string().description(
                    "Optional. Specifies where to send the message, using `platform:id` format. Defaults to the current channel. E.g., `onebot:123456789` for a group, or `discord:private:987654321` for a private chat."
                ),
            }),
            execute: async ({ koishiSession }, { message, target }) => {
                const toolLogger = this._logger.extend("send_message");

                if (!koishiSession) {
                    toolLogger.warn("✖ 缺少有效会话，无法发送消息。");
                    return Failed("缺少会话对象");
                }

                const messages = message.split("<sep/>").filter((msg) => msg.trim() !== "");
                if (messages.length === 0) {
                    toolLogger.warn("💬 待发送内容为空 | 原因: 消息分割后无有效内容。");
                    return Failed("消息内容为空");
                }

                try {
                    const { bot, channelId, finalTarget } = this.determineTarget(koishiSession, target);

                    if (!bot) {
                        const availablePlatforms = this.ctx.bots.map((b) => b.platform).join(", ");
                        toolLogger.warn(`✖ 未找到机器人实例 | 目标平台: ${target}, 可用平台: ${availablePlatforms}`);
                        return Failed(`未找到平台 ${target} 对应的机器人实例。`);
                    }

                    toolLogger.info(`🚀 准备发送消息 | 目标: ${finalTarget} | 分段数: ${messages.length}`);

                    await this.sendMessagesWithHumanLikeDelay(messages, bot, channelId, koishiSession);

                    return Success(`✅ 消息已成功发送至 ${finalTarget}`);
                } catch (error) {
                    this.handleError(error, `发送消息至 ${target || "当前频道"} 时发生错误`);
                    return Failed(`发送消息失败: ${error.message}`);
                }
            },
        });
    }

    /**
     * 决定消息的最终目标和使用的机器人实例
     */
    private determineTarget(koishiSession: Session, target?: string): { bot: Bot | undefined; channelId: string; finalTarget: string } {
        if (!target || target === `${koishiSession.platform}:${koishiSession.channelId}`) {
            // 发送至当前会话
            return {
                bot: koishiSession.bot,
                channelId: koishiSession.channelId,
                finalTarget: `${koishiSession.platform}:${koishiSession.channelId}`,
            };
        } else {
            // 发送至指定目标
            const parts = target.split(":");
            const platform = parts[0];
            const channelId = parts.slice(1).join(":");
            const bot = this.ctx.bots.find((b) => b.platform === platform);
            return { bot, channelId, finalTarget: target };
        }
    }

    /**
     * 带有“人性化”延迟的消息发送执行器
     * @param messages 要发送的消息数组
     * @param bot 用于发送的机器人实例
     * @param channelId 目标频道ID
     * @param originalSession 原始会话，用于创建after-send事件
     */
    private async sendMessagesWithHumanLikeDelay(messages: string[], bot: Bot, channelId: string, originalSession: Session): Promise<void> {
        const toolLogger = this._logger.extend("send_message_executor");

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i].trim();
            if (!msg) continue;

            // --- 人性化延迟的核心部分 ---
            const delay = this.getTypingDelay(msg);
            //toolLogger.debug(`Simulating typing... Delaying for ${delay}ms before sending: "${msg}"`);

            await sleep(delay);

            // --- 发送消息 ---
            const messageIds = await bot.sendMessage(channelId, msg);

            // --- 发送后处理（例如发射事件）---
            // 使用 then 回调不是最佳实践，async/await 更清晰
            if (messageIds && messageIds.length > 0) {
                this.emitAfterSendEvent(bot, channelId, msg, messageIds[0], originalSession);
                //toolLogger.debug(`✔ Message sent with ID: ${messageIds[0]}`);
            }

            // 如果还有下一条消息，增加一个“段落间隔”延迟
            if (i < messages.length - 1) {
                const paragraphDelay = 1000 + Math.random() * 1500; // 1秒到2.5秒的随机停顿
                //toolLogger.debug(`Pausing for ${paragraphDelay}ms between messages.`);
                await sleep(paragraphDelay);
            }
        }
    }

    /**
     * 封装 after-send 事件的发射逻辑
     */
    private emitAfterSendEvent(bot: Bot, channelId: string, content: string, messageId: string, originalSession: Session): void {
        const session = bot.session({
            ...originalSession.event,
            type: "after-send",
            message: {
                id: messageId,
                content: content,
                elements: h.parse(content),
                timestamp: Date.now(),
                user: bot.user,
            },
            channel: {
                id: channelId,
                type: originalSession.guildId ? 0 : 1,
            },
        });
        this.ctx.emit("after-send", session as Session);
    }

    private getTypingDelay(text: string): number {
        // --- 可配置参数 ---
        const BASE_DELAY = this.config.typing.baseDelay;

        // 中文输入模拟 (拼音输入法)
        const DELAY_PER_CHINESE_CHAR = this.config.typing.charPerSecond;
        const CHINESE_RANDOM_FACTOR = 0.5;

        // 英文输入模拟
        const DELAY_PER_ENGLISH_CHAR = this.config.typing.charPerSecond * 1.5;
        const ENGLISH_RANDOM_FACTOR = 0.3; // 英文输入的随机性较小

        // 延迟上下限
        const MIN_DELAY = this.config.typing.minDelay;
        const MAX_DELAY = this.config.typing.maxDelay;

        // --- 逻辑实现 ---

        // 1. 统计中英文字符数
        let chineseCharCount = 0;
        let englishCharCount = 0;

        // 使用正则表达式匹配中文字符 (Unicode范围)
        const chineseRegex = /[\u4e00-\u9fa5]/g;
        const chineseMatches = text.match(chineseRegex);
        chineseCharCount = chineseMatches ? chineseMatches.length : 0;

        // 英文及其他字符（数字、符号等）可以大致归为一类
        englishCharCount = text.length - chineseCharCount;

        // 2. 分别计算中英文部分的延迟
        const chineseDelay = chineseCharCount * DELAY_PER_CHINESE_CHAR;
        const englishDelay = englishCharCount * DELAY_PER_ENGLISH_CHAR;

        // 3. 计算总延迟并加入随机性
        // 随机性的大小也与中英文字符数量有关，让节奏更真实
        const totalRandomness = (chineseCharCount * CHINESE_RANDOM_FACTOR + englishCharCount * ENGLISH_RANDOM_FACTOR) / text.length;
        const randomFactor = 1 + (Math.random() - 0.5) * 2 * totalRandomness; // 在 (1-totalRandomness) 到 (1+totalRandomness) 之间

        const calculatedDelay = BASE_DELAY + (chineseDelay + englishDelay) * randomFactor;

        // 4. 应用延迟上下限
        return Math.max(MIN_DELAY, Math.min(calculatedDelay, MAX_DELAY));
    }
}
