import { Context, h, Logger, Random, Schema, Service, Session } from "koishi";
import type { ImagePart, TextPart } from "xsai";
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
    WorldState,
    WorldStateService,
} from "../services";
import { JsonParser, truncate } from "../shared";
import { AgentBehaviorConfig, ChannelDescriptor } from "./config";
import { ConversationFlowAnalyzer, FlowAnalysis } from "./conversation-flow-analyzer";
import { PromptBuilder, PromptContext } from "./prompt-builder";
import { Willingness, WillingnessCalculator } from "./willingness-calculator";

export class AgentCore extends Service<AgentBehaviorConfig> {
    static readonly inject = [Services.WorldState, Services.Model, Services.Tool, Services.Memory, Services.Image, Services.Logger];

    // 依赖的服务
    private readonly worldState: WorldStateService;
    private readonly modelService: ModelService;
    private readonly toolService: ToolService;

    // 内部组件
    private readonly _logger: Logger;
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
        this._logger = ctx[Services.Logger].getLogger("[智能体核心]");

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

        this.ctx.on("worldstate:segment-updated", async (session, segment) => {
            try {
                // 从 worldstate 接收到的消息即为过滤后的，在回复列表中
                // if (!this.isChannelAllowed(segment.platform, segment.channelId)) return;
                this.handleSegmentUpdate(session, segment);
            } catch (error) {
                this.handleError(error, `处理段落更新时 (ID: ${segment.id})`);
            }
        });

        this.startWillingnessDecay();
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
                this._logger.debug(`[响应] ⏳ 防抖计时结束，开始决策 | 频道: ${channelKey}`);
                this.decideToAct(session, segment);
                this.debounceTimers.delete(channelKey);
            }, this.config.arousal.debounceMs)
        );
    }

    private async decideToAct(session: Session, segment: DialogueSegment): Promise<void> {
        const channelKey = `${segment.platform}:${segment.channelId}`;
        this._logger.debug(`[决策] 🤔 开始评估 | 频道: ${channelKey}, 段落ID: ${segment.id}`);

        try {
            const analysis = this.flowAnalyzer.analyze(segment, this.config.willingness.keywords);
            analysis.isAgentMentioned = session.stripped.atSelf;
            const currentWillingness = this.channelWillingness.get(channelKey) || 0;
            const willingness = this.willingnessCalculator.calculate(analysis, currentWillingness);

            const action = willingness.shouldAct ? "✔ 行动" : "❌ 忽略";
            this._logger.debug(
                `[决策] 📊 意愿度评估 | W: ${currentWillingness.toFixed(2)} -> ${willingness.value.toFixed(2)} | 阈值: ${
                    willingness.threshold
                } | 决策: ${action} | 原因: ${willingness.reasons.join(";")}`
            );

            if (willingness.shouldAct) {
                const retainedWillingness = willingness.value * this.config.willingness.advanced.retentionAfterReply;
                this.channelWillingness.set(channelKey, retainedWillingness);
                await this.runAgentCycle(session, segment, analysis, willingness);
            } else {
                this.channelWillingness.set(channelKey, willingness.value);
            }
        } catch (error) {
            this.handleError(error, `决策过程中 (段落ID: ${segment.id})`);
        }
    }

    private async runAgentCycle(
        session: Session,
        segment: DialogueSegment,
        analysis: FlowAnalysis,
        willingness: Willingness
    ): Promise<void> {
        this._logger.debug(`[循环] 🌀 → 开始 | 段落ID: ${segment.id}`);
        const collectedResponses: AgentResponse[] = [];
        let shouldContinueHeartbeat = true;
        let heartbeatCount = 0;

        while (shouldContinueHeartbeat && heartbeatCount < this.config.heartbeat) {
            heartbeatCount++;
            this._logger.debug(`[心跳] ❤️ #${heartbeatCount} | 段落ID: ${segment.id}`);

            try {
                const promptContext = await this.buildPromptContext(segment, analysis, willingness, collectedResponses);
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

        const onetimeCode = Random.id(8);

        const worldState = await this.worldState.getWorldState(allowedChannels || [], onetimeCode);

        // 图片智能筛选与上下文构建
        const { images: multiModalContent } = await this.buildMultimodalContext(worldState);

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
            agentState: {
                lifeCycleStatus: "active",
                analysis: analysis,
                willingness: willingness,
            },
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
     * [新增] 构建多模态上下文的核心方法
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

        const allowedImageTypes = ["image/jpeg", "image/png"];

        for (const result of imageDataResults) {
            if (result && allowedImageTypes.includes(result.data?.mimeType)) {
                finalImages.push({ type: "text", text: `Image #${result.data.id}:` });
                finalImages.push({ type: "image_url", image_url: { url: result.content, detail: this.config.vision.detail } });
            }
        }

        // 构建带有引用标记的纯文本历史
        // const textualHistoryLines: string[] = [];
        // for (const channel of worldState.activeChannels) {
        //     textualHistoryLines.push(`--- Conversation History in Channel #${channel.name} ---`);
        //     for (const seg of channel.history) {
        //         for (const msg of seg.dialogue) {
        //             let content = msg.content;
        //             const elements = h.parse(content);
        //             // 替换占位符为带引用的格式
        //             for (const el of elements) {
        //                 if (el.type === "image" && el.attrs.id) {
        //                     const refNum = imageIdToRefNum.get(el.attrs.id as string);
        //                     if (refNum !== undefined) {
        //                         content = content.replace(`<image id="${el.attrs.id}"/>`, `[Image #${refNum}]`);
        //                     } else {
        //                         content = content.replace(`<image id="${el.attrs.id}"/>`, `[Omitted Image]`);
        //                     }
        //                 }
        //             }
        //             textualHistoryLines.push(`${msg.sender.name || "Unknown"}: ${content}`);
        //         }
        //     }
        // }

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
            description: "Sends a message to the human user.",
            parameters: Schema.object({
                inner_thoughts: Schema.string().description("仅供自己参考的内心独白。"),
                message: Schema.string().description("Message content to send. You can use '<sep/>' to send multiple messages."),
                target: Schema.string().description(
                    "Optional but important. The Platform and ID of the channel where the message should be sent. If the channel you want to send message to is not the current channel, you must specify this parameter. The target structure is 'platform:channel_id'. e.g. 'onebot:123456789'. If not provided, the message will default to the current channel."
                ),
            }),
            execute: async ({ koishiSession }, { message, target }) => {
                const toolLogger = this._logger.extend("send_message");
                if (!koishiSession) {
                    toolLogger.warn("✖ 缺少有效会话，无法发送消息。");
                    return Failed("缺少会话对象");
                }

                try {
                    const messages = message.split("<sep/>");
                    const finalTarget = target || `${koishiSession.platform}:${koishiSession.channelId}`;

                    if (!target || target === `${koishiSession.platform}:${koishiSession.channelId}`) {
                        toolLogger.debug(`→ 发送至当前会话 | 目标: ${finalTarget}`);
                        for (const msg of messages) {
                            await koishiSession.sendQueued(msg);
                        }
                        return Success("消息已发送至当前频道");
                    }

                    // 如果指定了不同的 target，使用 bot 发送消息
                    // 一个平台可能有多个 bot 客户端，后期需要判断代理人选择合适的 bot
                    // 私聊 channel_id 为 platform:private:user_id，群聊为 platform:group_id
                    // 可能需要不同的处理逻辑
                    const parts = target.split(":");
                    const platform = parts[0];
                    const channelId = parts.slice(1).join(":");

                    toolLogger.debug(`→ 发送至指定目标 | 目标: ${finalTarget}`);
                    const bot = this.ctx.bots.find((b) => b.platform === platform);
                    if (!bot) {
                        const platforms = this.ctx.bots.map((b) => b.platform).join(", ");
                        toolLogger.warn(`✖ 未找到平台对应的机器人 | 目标平台: ${platform}, 可用平台: ${platforms}`);
                        return Failed(`未找到平台 ${platform} 的机器人，可用平台: ${platforms}`);
                    }

                    for (const msg of messages) {
                        await bot.sendMessage(channelId, msg);
                    }
                    return Success(`消息已发送至 ${target}`);
                } catch (error) {
                    this.handleError(error, `发送消息至 ${target || koishiSession.channelId}`);
                    return Failed(`发送消息失败: ${error.message}`);
                }
            },
        });
    }
}
