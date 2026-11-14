import { createHash } from "node:crypto";

import { ImagePart, TextPart } from "@xsai/shared-chat";
import { Context, Logger, h } from "koishi";

import { AssetService } from "../asset";
import { Config } from "../config";
import { ToolService } from "../extension";
import type { LoggerService } from "../logger";
import { MemoryService } from "../memory";
import { ChatModelSwitcher } from "../model";
import { conversationChannelId } from "../shared/utils/conversation-scope";
import { AgentStimulus, ContextualMessage, MessageData, UserMessagePayload, WorldState, WorldStateService } from "../world";
import { sessionChannelType } from "../world/channel-metadata";
import type { ConversationStateResult } from "../world/conversation-state";
import { deriveConversationFocus, type ConversationFocus, FocusedWorldState } from "./context-packing";
import { matchContinuation, sameContinuation, type ContinuationMatch } from "./continuation";
import { assertReplyTurn } from "./reply-turn";

const hasImage = (message: ContextualMessage) => message.elements.some((element) => ["img", "image"].includes(element.type) && element.attrs.id);

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
    private pendingImageUsage = new WeakMap<object, { keys: string[]; taskId: string }>();
    private attachedImages = new WeakMap<object, string>();
    private attachedImageFingerprints = new Map<string, string>();
    private imageTaskUsage = new Map<string, Set<string>>();
    private anonymousTaskIds = new WeakMap<object, string>();
    private nextAnonymousTaskId = 0;
    private recentVisualSources = new Map<
        string,
        { sourceIds: string[]; timestamp: number; followUpIds: Set<string>; generation?: number; activeTaskId: string }
    >();

    /** Only actual image parts created by this builder establish that pixels were attached. */
    public getAttachedImageIds(messages: Array<{ content?: unknown }>): string[] {
        const ids = new Set<string>();
        for (const message of messages) {
            if (!Array.isArray(message.content)) continue;
            for (const part of message.content) {
                if (part?.type !== "image_url") continue;
                const url = part.image_url?.url;
                const id =
                    this.attachedImages.get(part) ??
                    (typeof url === "string" ? this.attachedImageFingerprints.get(createHash("sha256").update(url).digest("hex")) : undefined);
                if (id) ids.add(id);
            }
        }
        return [...ids];
    }

    private visualDiagnostic(reason: string, counts: Record<string, number> = {}): void {
        // Never log message text, asset URLs, base64, or caller-supplied error strings.
        this.logger.debug(`图片上下文 | ${JSON.stringify({ reason, ...counts })}`);
    }

    /** Count an image once only after the model request succeeds. Failed requests retain their allowance. */
    public commitMultimodalUsage(messages: Array<{ content?: unknown }>): void {
        for (const message of messages) {
            if (!Array.isArray(message.content)) continue;
            for (const part of message.content) {
                if (!part || typeof part !== "object") continue;
                const pending = this.pendingImageUsage.get(part);
                if (!pending) continue;
                this.pendingImageUsage.delete(part);
                const used = this.imageTaskUsage.get(pending.taskId) ?? new Set<string>();
                this.imageTaskUsage.delete(pending.taskId);
                this.imageTaskUsage.set(pending.taskId, used);
                for (const key of pending.keys) {
                    if (used.has(key)) continue;
                    used.add(key);
                    const count = this.imageLifecycleTracker.get(key) ?? 0;
                    this.imageLifecycleTracker.delete(key);
                    this.imageLifecycleTracker.set(key, Math.min(count + 1, Math.max(0, this.config.imageLifecycleCount)));
                }
            }
        }
        // Retain a bounded recent working set rather than every image seen since startup.
        while (this.imageTaskUsage.size > 512) this.imageTaskUsage.delete(this.imageTaskUsage.keys().next().value!);
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
        const triggerIds: string[] =
            type === "user_message" && Array.isArray(payload?.messageIds)
                ? [...new Set<string>(payload.messageIds.filter((id: unknown): id is string => typeof id === "string" && !!id))]
                : type === "background_task_completion" && session.messageId
                  ? [session.messageId]
                  : [];
        if (this.worldStateService.readMessageWindow) {
            for (const messageId of triggerIds) {
                const history = [...sourceWorldState.l1_working_memory.processed_events, ...sourceWorldState.l1_working_memory.new_events];
                const currentIds = new Set(history.filter((item) => item.type === "message").map((item) => item.id));
                const anchor = history.find((item) => item.type === "message" && item.id === messageId);
                if (anchor?.type === "message" && (!anchor.quoteId || currentIds.has(anchor.quoteId))) continue;
                try {
                    const page = await this.worldStateService.readMessageWindow(session, { messageId, before: 0, after: 0, limit: 1 });
                    assertContextCurrent();
                    const sources = [page.anchor, ...page.quotes.flatMap((quote) => (quote.record ? [quote.record] : []))];
                    const messages = sources
                        .filter((record) => {
                            if (currentIds.has(record.id)) return false;
                            currentIds.add(record.id);
                            return true;
                        })
                        .map((record) => ({
                            type: "message" as const,
                            id: record.id,
                            sender: record.sender,
                            content: record.content,
                            quoteId: record.quoteId,
                            timestamp: new Date(record.timestamp),
                            elements: h.parse(record.content),
                            is_message: true,
                            is_new: false,
                        }));
                    sourceWorldState = {
                        ...sourceWorldState,
                        l1_working_memory: {
                            ...sourceWorldState.l1_working_memory,
                            processed_events: [...messages, ...sourceWorldState.l1_working_memory.processed_events].sort(
                                (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
                            ),
                        },
                    };
                } catch (error) {
                    assertContextCurrent();
                    if (error instanceof Error && error.name === "AbortError") throw error;
                    this.logger.warn(`触发来源读取失败，保留缺失标记：${String(error)}`);
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
                    is_message: true,
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
        sourceWorldState = await this.prepareVisualSources(stimulus, sourceWorldState, focus, generation, assertContextCurrent);
        assertContextCurrent();
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
            case "scheduled_task":
                triggerContext = {
                    isScheduledTask: true,
                    details: JSON.stringify(payload ?? {}).replace(/[<>&]/g, (value) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[value]!),
                };
                break;
            case "system_event":
                triggerContext = {
                    isSystemEvent: true,
                    event: { ...payload, eventType: payload?.eventType ?? payload?.type },
                    details: JSON.stringify(payload ?? {}).replace(/[<>&]/g, (value) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[value]!),
                };
                break;
            default:
                break;
        }
        worldState.triggerContext = { ...triggerContext, conversationFocus: worldState.conversationFocus };

        // 5. 返回最终的上下文对象
        return {
            toolSchemas: this.toolService.getToolSchemas(session, "model"),
            memoryBlocks: this.memoryService.getMemoryBlocksForRendering(),
            worldState: worldState,
        };
    }

    private async prepareVisualSources(
        stimulus: AgentStimulus<any>,
        world: WorldState,
        focus: ConversationFocus,
        generation: number | undefined,
        assertCurrent: () => void,
    ): Promise<WorldState> {
        if (!this.config.enableVision || !this.modelSwitcher.hasVisionCapability() || !(this.config.maxImagesInContext > 0)) return world;
        const triggerIds = focus.triggerMessageIds;
        let taskId = triggerIds.length
            ? JSON.stringify([focus.target, focus.targetUserId, stimulus.type, [...triggerIds].sort()])
            : this.anonymousTaskIds.get(stimulus);
        if (!taskId) {
            taskId = `anonymous-task-${++this.nextAnonymousTaskId}`;
            this.anonymousTaskIds.set(stimulus, taskId);
        }
        focus.visualTaskId = taskId;
        if (stimulus.type !== "user_message" || !focus.targetUserId || !triggerIds.length) return world;
        const scope = JSON.stringify([focus.target, sessionChannelType(stimulus.session), focus.targetUserId]);
        const messages = [...world.l1_working_memory.processed_events, ...world.l1_working_memory.new_events].filter(
            (item): item is ContextualMessage & { type: "message" } => item.type === "message",
        );
        const now = Date.now();
        const windowMs = Math.max(0, Math.min(86400, this.config.imageFollowUpWindowSeconds ?? 600)) * 1000;
        const maxFollowUps = Math.max(0, Math.min(20, this.config.imageFollowUpMaxTurns ?? 4));
        let ownMessages = messages.filter((message) => message.sender?.id === focus.targetUserId);
        const discoveredSources = new Map<string, MessageData & ContextualMessage & { type: "message"; is_message: boolean }>();
        const cached = this.recentVisualSources.get(scope);
        // A photo received while the channel was busy may never have been a trigger.
        // Inspect only the 19 preceding messages plus the current anchor, once per task.
        if (
            windowMs > 0 &&
            maxFollowUps > 0 &&
            cached?.activeTaskId !== taskId &&
            !ownMessages.some((message) => triggerIds.includes(message.id) && hasImage(message)) &&
            this.worldStateService.readMessageWindow
        ) {
            try {
                const page = await this.worldStateService.readMessageWindow(stimulus.session, {
                    messageId: triggerIds.at(-1)!,
                    before: 19,
                    after: 0,
                    limit: 20,
                });
                assertCurrent();
                for (const source of (page.records ?? []).slice(-20)) {
                    if (
                        source.sender?.id !== focus.targetUserId ||
                        source.platform !== stimulus.session.platform ||
                        source.channelId !== conversationChannelId(stimulus.session) ||
                        source.channelType !== sessionChannelType(stimulus.session)
                    )
                        continue;
                    const timestamp = new Date(source.timestamp);
                    if (!Number.isFinite(timestamp.getTime()) || now - timestamp.getTime() > windowMs || timestamp.getTime() > now + 1000) continue;
                    discoveredSources.set(source.id, {
                        ...source,
                        type: "message",
                        timestamp,
                        elements: h.parse(source.content),
                        is_message: true,
                        is_new: false,
                    });
                }
                ownMessages = [...new Map([...ownMessages, ...discoveredSources.values()].map((message) => [message.id, message])).values()];
            } catch (error) {
                assertCurrent();
                if (error instanceof Error && error.name === "AbortError") throw error;
                this.visualDiagnostic("recent_source_discovery_failed");
            }
        }
        const currentImages = ownMessages
            .filter((message) => triggerIds.includes(message.id) && hasImage(message))
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        let recent = this.recentVisualSources.get(scope);
        if (recent?.generation !== generation) recent = undefined;
        if (currentImages.length) {
            recent = {
                sourceIds: currentImages.slice(0, this.config.maxImagesInContext).map((message) => message.id),
                timestamp: Math.min(now, currentImages[0].timestamp.getTime()),
                followUpIds: new Set(),
                generation,
                activeTaskId: taskId,
            };
        } else if (windowMs > 0 && maxFollowUps > 0 && recent?.activeTaskId !== taskId) {
            const latest = ownMessages.filter(hasImage).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
            if (latest && now - latest.timestamp.getTime() <= windowMs && (!recent || latest.timestamp.getTime() > recent.timestamp)) {
                recent = {
                    sourceIds: [latest.id],
                    timestamp: Math.min(now, latest.timestamp.getTime()),
                    followUpIds: new Set(
                        ownMessages
                            .filter((message) => message.timestamp >= latest.timestamp && message.id !== latest.id)
                            .map((message) => message.id)
                            .slice(0, maxFollowUps + 1),
                    ),
                    generation,
                    activeTaskId: "",
                };
            }
        }
        if (!recent) {
            this.recentVisualSources.delete(scope);
            return world;
        }
        const sameTask = recent.activeTaskId === taskId;
        if (!sameTask) {
            // Count recorded user messages even when they did not wake the agent.
            const subsequentIds = ownMessages.filter((message) => message.timestamp.getTime() >= recent.timestamp).map((message) => message.id);
            for (const id of [...subsequentIds, ...triggerIds]) {
                if (!recent.sourceIds.includes(id) && recent.followUpIds.size <= maxFollowUps) recent.followUpIds.add(id);
            }
        }
        this.recentVisualSources.delete(scope);
        this.recentVisualSources.set(scope, recent);
        while (this.recentVisualSources.size > 256) this.recentVisualSources.delete(this.recentVisualSources.keys().next().value!);
        if (!sameTask && (!(windowMs > 0) || !(maxFollowUps > 0) || now - recent.timestamp > windowMs || recent.followUpIds.size > maxFollowUps)) {
            this.visualDiagnostic("recent_image_window_expired", {
                window_seconds: windowMs / 1000,
                max_followups: maxFollowUps,
                follow_up_count: recent.followUpIds.size,
                age_seconds: Math.max(0, Math.floor((now - recent.timestamp) / 1000)),
            });
            return world;
        }
        recent.activeTaskId = taskId;
        const present = new Set(messages.map((message) => message.id));
        const restored: Array<ContextualMessage & { type: "message"; is_message: boolean }> = [];
        for (const messageId of recent.sourceIds) {
            if (present.has(messageId)) continue;
            if (!this.worldStateService.readMessageWindow) {
                this.visualDiagnostic("source_restore_unavailable");
                continue;
            }
            try {
                const discovered = discoveredSources.get(messageId);
                const page = discovered
                    ? undefined
                    : await this.worldStateService.readMessageWindow(stimulus.session, { messageId, before: 0, after: 0, limit: 1 });
                assertCurrent();
                const source = discovered ?? page!.anchor;
                if (
                    source.id !== messageId ||
                    source.sender?.id !== focus.targetUserId ||
                    source.platform !== stimulus.session.platform ||
                    source.channelId !== conversationChannelId(stimulus.session) ||
                    source.channelType !== sessionChannelType(stimulus.session)
                ) {
                    this.visualDiagnostic("source_scope_mismatch");
                    continue;
                }
                const message = {
                    type: "message" as const,
                    id: source.id,
                    sender: source.sender,
                    content: source.content,
                    timestamp: new Date(source.timestamp),
                    quoteId: source.quoteId,
                    elements: h.parse(source.content),
                    is_message: true,
                    is_new: false,
                };
                if (!hasImage(message)) {
                    this.visualDiagnostic("source_image_missing");
                    continue;
                }
                restored.push(message);
                present.add(message.id);
            } catch (error) {
                assertCurrent();
                if (error instanceof Error && error.name === "AbortError") throw error;
                this.visualDiagnostic("source_restore_failed");
            }
        }
        focus.visualSourceMessageIds = recent.sourceIds.filter((id) => present.has(id));
        return restored.length
            ? {
                  ...world,
                  l1_working_memory: {
                      ...world.l1_working_memory,
                      processed_events: [...restored, ...world.l1_working_memory.processed_events].sort(
                          (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
                      ),
                  },
              }
            : world;
    }

    /**
     * 构建多模态消息内容，如果模型和配置支持。
     * @returns 包含图片和文本的消息内容数组，或纯文本字符串。
     */
    public async buildMultimodalUserMessage(userPromptText: string, worldState: WorldState): Promise<string | Array<ImagePart | TextPart>> {
        const canUseVision = this.modelSwitcher.hasVisionCapability() && this.config.enableVision;
        if (!canUseVision) {
            this.visualDiagnostic(this.config.enableVision ? "no_vision_model" : "vision_disabled");
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
            const taskId = (worldState as FocusedWorldState).conversationFocus?.visualTaskId ?? `anonymous-image-${++this.nextAnonymousTaskId}`;
            let imageIndex = 0;
            for (const part of content) {
                if (part.type !== "image_url") continue;
                this.pendingImageUsage.set(part, { keys: [multiModalData.usageKeys[imageIndex++]], taskId });
            }
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

        const focus = (worldState as FocusedWorldState).conversationFocus;
        const quoteIds = new Set(focus?.quoteMessageIds ?? allMessages.flatMap((message) => (message.quoteId ? [message.quoteId] : [])));
        const currentIds = new Set(focus?.triggerMessageIds ?? []);
        const relatedIds = new Set(focus?.visualSourceMessageIds ?? []);
        const diagnostics = {
            lifecycle_limit: this.config.imageLifecycleCount,
            max_images: this.config.maxImagesInContext,
            candidates: 0,
            lifecycle_expired: 0,
            count_limit: 0,
            missing_asset: 0,
            asset_metadata_failed: 0,
            asset_read_failed: 0,
            unsupported_mime: 0,
            invalid_image_data: 0,
            selected: 0,
        };

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
                priority: currentIds.has(msg.id) ? 3 : isQuotedImage ? 2 : relatedIds.has(msg.id) ? 1 : 0,
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
        diagnostics.candidates = sortedUniqueCandidates.length;
        for (const candidate of sortedUniqueCandidates) {
            if (finalImageIds.size >= Math.max(0, this.config.maxImagesInContext)) {
                diagnostics.count_limit++;
                continue;
            }

            const key = JSON.stringify([
                worldState.channel?.platform,
                worldState.self?.id,
                worldState.channel?.type,
                (worldState as FocusedWorldState).conversationFocus?.target.channelId ?? worldState.channel?.id,
                candidate.sourceId,
                candidate.id,
            ]);
            const usageCount = this.imageLifecycleTracker.get(key) || 0;
            if (
                candidate.priority > 0 ||
                (focus?.visualTaskId && this.imageTaskUsage.get(focus.visualTaskId)?.has(key)) ||
                usageCount < this.config.imageLifecycleCount
            ) {
                finalImageIds.add(candidate.id);
                usageKeysById.set(candidate.id, key);
            } else diagnostics.lifecycle_expired++;
        }

        // 5. 获取图片数据并格式化输出
        if (finalImageIds.size === 0) {
            this.visualDiagnostic("no_images_selected", diagnostics);
            return { images: [], usageKeys: [] };
        }

        const imageDataResults = await Promise.allSettled(Array.from(finalImageIds, (id) => this.assetService.getInfo(id)));
        assertReplyTurn();
        const finalImages: Array<ImagePart | TextPart> = [];
        const usageKeys: string[] = [];
        const allowedImageTypes = new Set(this.config.allowedImageTypes);

        for (const outcome of imageDataResults) {
            if (outcome.status === "rejected") {
                diagnostics.asset_metadata_failed++;
                continue;
            }
            const result = outcome.value;
            if (!result) {
                diagnostics.missing_asset++;
                continue;
            }
            if (!allowedImageTypes.has(result.mime)) {
                diagnostics.unsupported_mime++;
                continue;
            }
            let imageBuffer: Awaited<ReturnType<AssetService["read"]>>;
            try {
                imageBuffer = await this.assetService.read(result.id, { format: "data-url", image: { process: true, format: "jpeg" } });
            } catch {
                assertReplyTurn();
                diagnostics.asset_read_failed++;
                continue;
            }
            assertReplyTurn();
            if (typeof imageBuffer !== "string" || !/^data:image\/[^;,]+;base64,[A-Za-z0-9+/=\s]+$/.test(imageBuffer)) {
                diagnostics.invalid_image_data++;
                continue;
            }
            usageKeys.push(usageKeysById.get(result.id)!);
            // 为LLM提供更明确的图片标识
            finalImages.push({ type: "text", text: `The following is an image with ID #${result.id}:` });
            const image: ImagePart = { type: "image_url", image_url: { url: imageBuffer, detail: this.config.detail } };
            this.attachedImages.set(image, result.id);
            const fingerprint = createHash("sha256").update(imageBuffer).digest("hex");
            this.attachedImageFingerprints.delete(fingerprint);
            this.attachedImageFingerprints.set(fingerprint, result.id);
            while (this.attachedImageFingerprints.size > 512) this.attachedImageFingerprints.delete(this.attachedImageFingerprints.keys().next().value!);
            finalImages.push(image);
            diagnostics.selected++;
        }

        this.visualDiagnostic("image_selection", diagnostics);
        return { images: finalImages, usageKeys };
    }
}
