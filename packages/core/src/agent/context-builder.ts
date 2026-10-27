import { ImagePart, TextPart } from "@xsai/shared-chat";
import { Context, Logger, h } from "koishi";

import { AssetService } from "../asset";
import { Config } from "../config";
import { ToolService } from "../extension";
import type { LoggerService } from "../logger";
import { MemoryService } from "../memory";
import { ChatModelSwitcher } from "../model";
import { conversationChannelId } from "../shared/utils/conversation-scope";
import { AgentStimulus, ContextualMessage, UserMessagePayload, WorldState, WorldStateService } from "../world";
import { sessionChannelType } from "../world/channel-metadata";
import type { ConversationStateResult } from "../world/conversation-state";
import { deriveConversationFocus, FocusedWorldState } from "./context-packing";
import { matchContinuation, sameContinuation, type ContinuationMatch } from "./continuation";
import { assertReplyTurn } from "./reply-turn";

interface ImageCandidate {
    id: string;
    timestamp: number;
    priority: number;
    sourceId: string;
}

/**
 * @description 负责为 Agent 的单次心跳构建完整的提示词上下文。
 * 它聚合了世界状态、记忆、工具定义，并处理复杂的多模态（图片）内容筛选。
 */
export class PromptContextBuilder {
    private readonly logger: Logger;
    private readonly assetService: AssetService;
    private readonly memoryService: MemoryService;
    private readonly toolService: ToolService;
    private readonly worldStateService: WorldStateService;
    private readonly modelSwitcher: ChatModelSwitcher;
    private imageLifecycleTracker = new Map<string, number>();
    private pendingImageUsage = new WeakMap<object, string[]>();

    /** Count an image once only after the model request succeeds. Failed requests retain their allowance. */
    public commitMultimodalUsage(messages: Array<{ content?: unknown }>): void {
        for (const message of messages) {
            if (!message.content || typeof message.content !== "object") continue;
            const keys = this.pendingImageUsage.get(message.content);
            if (!keys) continue;
            this.pendingImageUsage.delete(message.content);
            for (const key of keys) {
                const count = this.imageLifecycleTracker.get(key) ?? 0;
                this.imageLifecycleTracker.delete(key);
                this.imageLifecycleTracker.set(key, Math.min(count + 1, Math.max(0, this.config.imageLifecycleCount)));
            }
        }
        // Retain a bounded recent working set rather than every image seen since startup.
        while (this.imageLifecycleTracker.size > 4096) this.imageLifecycleTracker.delete(this.imageLifecycleTracker.keys().next().value!);
    }

    constructor(
        private readonly ctx: Context,
        private readonly config: Config,
        deps: {
            model: ChatModelSwitcher;
            logging: LoggerService;
            asset: AssetService;
            memory: MemoryService;
            tool: ToolService;
            world: WorldStateService;
        },
    ) {
        this.logger = deps.logging.getLogger("[上下文构建器]");
        this.assetService = deps.asset;
        this.memoryService = deps.memory;
        this.toolService = deps.tool;
        this.worldStateService = deps.world;
        this.modelSwitcher = deps.model;
    }

    /**
     * 构建完整的上下文对象，用于渲染提示词模板。
     */
    public async build(stimulus: AgentStimulus<any>) {
        const { type, session, payload } = stimulus;
        const target = { platform: session.platform, channelId: conversationChannelId(session)!, channelType: sessionChannelType(session) };
        const binding = () =>
            JSON.stringify([
                session.platform,
                session.selfId,
                session.channelId,
                sessionChannelType(session),
                session.isDirect,
                session.userId,
                session.guildId,
            ]);
        const originalBinding = binding();
        const generation = this.worldStateService.l2_manager?.getHistoryGeneration?.(target);
        const assertContextCurrent = () => {
            assertReplyTurn();
            if (binding() !== originalBinding) throw new Error("上下文构建期间会话身份已改变");
            if (this.ctx.filter?.(session) === false || this.worldStateService.isChannelAllowed?.(session) === false)
                throw new Error("上下文构建期间会话授权或配置已改变");
            if (generation !== undefined && this.worldStateService.l2_manager?.getHistoryGeneration?.(target) !== generation)
                throw new Error("上下文构建期间历史已清除");
        };
        assertContextCurrent();
        let sourceWorldState = await this.worldStateService.buildWorldState(session);
        assertContextCurrent();
        if (type === "background_task_completion" && session.messageId && this.worldStateService.readMessageWindow) {
            const present = [...sourceWorldState.l1_working_memory.processed_events, ...sourceWorldState.l1_working_memory.new_events].some(
                (item) => item.type === "message" && item.id === session.messageId,
            );
            if (!present) {
                try {
                    const page = await this.worldStateService.readMessageWindow(session, { messageId: session.messageId, before: 0, after: 0, limit: 1 });
                    assertContextCurrent();
                    const sources = [page.anchor, ...page.quotes.flatMap((quote) => (quote.record ? [quote.record] : []))];
                    const currentIds = new Set(
                        [...sourceWorldState.l1_working_memory.processed_events, ...sourceWorldState.l1_working_memory.new_events]
                            .filter((item) => item.type === "message")
                            .map((item) => item.id),
                    );
                    const messages = sources
                        .filter((record) => !currentIds.has(record.id))
                        .map((record) => ({
                            type: "message" as const,
                            id: record.id,
                            sender: record.sender,
                            content: record.content,
                            quoteId: record.quoteId,
                            timestamp: new Date(record.timestamp),
                            elements: h.parse(record.content),
                            is_new: false,
                        }));
                    sourceWorldState = {
                        ...sourceWorldState,
                        l1_working_memory: {
                            ...sourceWorldState.l1_working_memory,
                            processed_events: [...messages, ...sourceWorldState.l1_working_memory.processed_events]
                                .filter(
                                    (item, index, items) =>
                                        item.type !== "message" || items.findIndex((other) => other.type === "message" && other.id === item.id) === index,
                                )
                                .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
                        },
                    };
                } catch (error) {
                    assertContextCurrent();
                    if (error instanceof Error && error.name === "AbortError") throw error;
                    this.logger.warn(`后台任务来源读取失败，保留缺失标记：${String(error)}`);
                }
            }
        }
        const focus = deriveConversationFocus(stimulus, sourceWorldState);
        if (this.config.continuation?.enabled)
            focus.continuationPolicy = {
                mode: this.config.continuation.mode,
                maxDurationSeconds: this.config.continuation.maxDurationSeconds,
            };
        // Optional for older service adapters. The service validates raw sources and current scope.
        const stateService = this.worldStateService as WorldStateService & {
            getConversationState?: (session: AgentStimulus<any>["session"], options?: { includeSources?: boolean }) => Promise<ConversationStateResult>;
        };
        let working: Awaited<ReturnType<NonNullable<typeof stateService.getConversationState>>> | undefined;
        try {
            working = await stateService.getConversationState?.(session, { includeSources: this.config.continuation?.enabled === true });
        } catch (error) {
            assertContextCurrent();
            if (error instanceof Error && error.name === "AbortError") throw error;
            this.logger.warn(`工作状态读取失败，继续使用 unknown：${String(error)}`);
        }
        assertContextCurrent();
        const traced = stimulus as AgentStimulus<any> & { continuation?: ContinuationMatch; continuationRequired?: boolean };
        const continuation = traced.continuation;
        const currentContinuation = matchContinuation(session, this.config.continuation, working);
        if (traced.continuationRequired && !sameContinuation(continuation, currentContinuation)) throw new DOMException("会话等待已到期或被替换", "AbortError");
        if (sameContinuation(continuation, currentContinuation)) focus.continuation = currentContinuation;
        if (this.config.continuation?.enabled && working?.unknown === false && working.sourceMessages?.length) {
            const present = new Set(
                [...sourceWorldState.l1_working_memory.processed_events, ...sourceWorldState.l1_working_memory.new_events]
                    .filter((item) => item.type === "message")
                    .map((item) => item.id),
            );
            const recalled = working.sourceMessages
                .filter((record) => !present.has(record.id))
                .map((record) => ({
                    type: "message" as const,
                    id: record.id,
                    sender: record.sender,
                    content: record.content,
                    quoteId: record.quoteId,
                    timestamp: new Date(record.timestamp),
                    elements: h.parse(record.content),
                    is_new: false,
                }));
            sourceWorldState = {
                ...sourceWorldState,
                l1_working_memory: {
                    ...sourceWorldState.l1_working_memory,
                    processed_events: [...recalled, ...sourceWorldState.l1_working_memory.processed_events].sort(
                        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
                    ),
                },
            };
        }
        focus.explicitWorkingState = {
            ...(working?.unknown === false ? working.state : undefined),
            unknown: working?.unknown ?? true,
            sourceProvenance: "explicit_scoped_tool_state_not_verified_fact",
        };
        const present = new Set(
            [...sourceWorldState.l1_working_memory.processed_events, ...sourceWorldState.l1_working_memory.new_events].flatMap((item) =>
                item.type === "message" ? [item.id] : [],
            ),
        );
        focus.missingMessageIds = [
            ...new Set([...focus.missingMessageIds, ...(focus.explicitWorkingState?.sourceMessageIds ?? []).filter((id) => !present.has(id))]),
        ];
        const worldState: FocusedWorldState = { ...sourceWorldState, conversationFocus: focus };
        if (this.toolService.background) worldState.backgroundTasks = this.toolService.background.snapshots(session);
        assertContextCurrent();

        let triggerContext: object = {};
        switch (type) {
            case "user_message":
                triggerContext = { isUserMessage: true, messageIds: (payload as UserMessagePayload).messageIds };
                break;
            case "background_task_completion":
                triggerContext = { isBackgroundTaskCompletion: true, taskIds: payload?.taskIds, requestId: payload?.requestId, outcome: payload?.outcome };
                break;
            case "system_event":
                triggerContext = { isSystemEvent: true, event: payload };
                break;
            default:
                break;
        }
        worldState.triggerContext = { ...triggerContext, conversationFocus: worldState.conversationFocus };

        // 5. 返回最终的上下文对象
        return {
            toolSchemas: this.toolService.getToolSchemas(session),
            memoryBlocks: this.memoryService.getMemoryBlocksForRendering(),
            worldState: worldState,
        };
    }

    /**
     * 构建多模态消息内容，如果模型和配置支持。
     * @returns 包含图片和文本的消息内容数组，或纯文本字符串。
     */
    public async buildMultimodalUserMessage(userPromptText: string, worldState: WorldState): Promise<string | Array<ImagePart | TextPart>> {
        const canUseVision = this.modelSwitcher.hasVisionCapability() && this.config.enableVision;
        if (!canUseVision) {
            return userPromptText;
        }

        const multiModalData = await this.buildMultimodalImages(worldState);
        if (multiModalData.images.length > 0) {
            this.logger.debug(`上下文包含 ${multiModalData.images.length / 2} 张图片，将构建多模态消息。`);
            const content = [
                { type: "text" as const, text: this.config.multiModalSystemTemplate },
                ...multiModalData.images,
                { type: "text" as const, text: userPromptText },
            ];
            this.pendingImageUsage.set(content, multiModalData.usageKeys);
            return content;
        }

        return userPromptText;
    }

    /**
     * @description 构建多模态上下文。
     * 采用更声明式的方法来智能筛选图片，提高可读性和可维护性。
     * @param worldState 当前的世界状态
     * @returns 包含筛选后的图片内容的对象
     */
    private async buildMultimodalImages(worldState: WorldState): Promise<{ images: Array<ImagePart | TextPart>; usageKeys: string[] }> {
        // 1. 将所有消息扁平化并建立索引
        const allMessages = [...(worldState.l1_working_memory.processed_events || []), ...(worldState.l1_working_memory.new_events || [])].filter(
            (item): item is { type: "message" } & ContextualMessage => item.type === "message",
        );

        const quoteIds = new Set(allMessages.flatMap((message) => (message.quoteId ? [message.quoteId] : [])));

        const imageTags = ["img", "image"];

        // 2. 收集所有潜在的图片候选者，并赋予优先级
        const imageCandidates: ImageCandidate[] = allMessages.flatMap((msg) => {
            const elements = msg.elements;
            const imageIds = elements.filter((e) => imageTags.includes(e.type) && e.attrs.id).map((e) => e.attrs.id as string);

            // The referenced source carries the image, rather than the quoting message.
            const isQuotedImage = quoteIds.has(msg.id);

            return imageIds.map((id) => ({
                id,
                sourceId: msg.id,
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
                .values(),
        );

        // 4. 根据生命周期和数量上限选择最终图片
        const finalImageIds = new Set<string>();
        const usageKeysById = new Map<string, string>();
        for (const candidate of sortedUniqueCandidates) {
            if (finalImageIds.size >= this.config.maxImagesInContext) break;

            const key = JSON.stringify([
                worldState.channel?.platform,
                worldState.self?.id,
                worldState.channel?.type,
                worldState.channel?.id,
                candidate.sourceId,
                candidate.id,
            ]);
            const usageCount = this.imageLifecycleTracker.get(key) || 0;
            if (candidate.priority > 0 || usageCount < this.config.imageLifecycleCount) {
                finalImageIds.add(candidate.id);
                usageKeysById.set(candidate.id, key);
            }
        }

        // 5. 获取图片数据并格式化输出
        if (finalImageIds.size === 0) {
            return { images: [], usageKeys: [] };
        }

        const imageDataResults = await Promise.all(Array.from(finalImageIds).map((id) => this.assetService.getInfo(id)));

        const finalImages: Array<ImagePart | TextPart> = [];
        const usageKeys: string[] = [];
        const allowedImageTypes = new Set(this.config.allowedImageTypes);

        for (const result of imageDataResults) {
            if (result && allowedImageTypes.has(result.mime)) {
                const imageBuffer = await this.assetService.read(result.id, {
                    format: "data-url",
                    image: { process: true, format: "jpeg" },
                });
                usageKeys.push(usageKeysById.get(result.id)!);
                // 为LLM提供更明确的图片标识
                finalImages.push({ type: "text", text: `The following is an image with ID #${result.id}:` });
                finalImages.push({
                    type: "image_url",
                    image_url: { url: imageBuffer as string, detail: this.config.detail },
                });
            }
        }

        return { images: finalImages, usageKeys };
    }
}
