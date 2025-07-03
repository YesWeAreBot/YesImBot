import { Context, h, Random, Schema, Service, Session } from "koishi";
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
import { JsonParser } from "../shared";
import { AgentBehaviorConfig, ChannelDescriptor } from "./config";
import { ConversationFlowAnalyzer, FlowAnalysis } from "./conversation-flow-analyzer";
import { PromptBuilder, PromptContext } from "./prompt-builder";
import { Willingness, WillingnessCalculator } from "./willingness-calculator";

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
                const { messages } = await this.promptBuilder.build(promptContext);

                const chatModel = this.modelSwitcher.getCurrent();
                const llmRawResponse = await chatModel.chat(messages, {
                    debug: this.config.system.debug.enable,
                    logger: this.ctx.logger("[LLM]"),
                });

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

        for (const result of imageDataResults) {
            if (result) {
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

    // [NEW] 统一的错误处理函数
    private handleError(error: unknown, context: string): void {
        if (error instanceof Error) {
            this.ctx.logger.error(`An error occurred ${context}: ${error.message}\n${error.stack}`);
        } else {
            this.ctx.logger.error(`An unknown error occurred ${context}:`, error);
        }
    }

    // 处理和记录AI发送的消息
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
                target: Schema.string().description(
                    "Optional but important. The Platform and ID of the channel where the message should be sent. If the channel you want to send message to is not the current channel, you must specify this parameter. The target structure is 'platform:channel_id'. e.g. 'onebot:123456789'. If not provided, the message will default to the current channel."
                ),
            }),
            execute: async ({ koishiSession }, { message, target }) => {
                if (!koishiSession) {
                    this.ctx.logger.warn("SendMessageTool called without a valid session.");
                    return Failed("Missing session object");
                }

                try {
                    const messages = message.split("<sep/>");

                    // 如果没有指定 target，或者 target 与当前频道相同，使用 session 直接回复
                    if (!target || target === `${koishiSession.platform}:${koishiSession.channelId}`) {
                        for (const msg of messages) {
                            await koishiSession.sendQueued(msg);
                        }
                        return Success();
                    }

                    // 如果指定了不同的 target，使用 bot 发送消息
                    // 一个平台可能有多个 bot 客户端，后期需要判断代理人选择合适的 bot
                    // 私聊 channel_id 为 platform:private:user_id，群聊为 platform:group_id
                    // 可能需要不同的处理逻辑
                    const parts = target.split(":");
                    const platform = parts[0];
                    const channelId = parts.slice(1).join(":");

                    const bot = this.ctx.bots.find((b) => b.platform === platform);
                    if (!bot) {
                        const platforms = this.ctx.bots.map((b) => b.platform).join(", ");
                        this.ctx.logger.warn(`Bot not found for platform ${platform}, platforms must be one of ${platforms}`);
                        return Failed(`Bot not found for platform ${platform}`);
                    }

                    for (const msg of messages) {
                        await bot.sendMessage(channelId, msg);
                    }
                    return Success();
                } catch (error) {
                    this.handleError(error, `sending message to channel ${target || koishiSession.channelId}`);
                    return Failed(`Failed to send message: ${error.message}`);
                }
            },
        });
    }
}
