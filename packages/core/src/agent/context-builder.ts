import { ImagePart, TextPart } from "@xsai/shared-chat";
import { Context, Logger } from "koishi";

import { AssetService } from "../asset";
import { Config } from "../config";
import { ToolService } from "../extension";
import type { LoggerService } from "../logger";
import { MemoryService } from "../memory";
import { ChatModelSwitcher } from "../model";
import { AgentStimulus, ContextualMessage, UserMessagePayload, WorldState, WorldStateService } from "../world";
import { deriveConversationFocus, FocusedWorldState } from "./context-packing";
import { assertReplyTurn } from "./reply-turn";

interface ImageCandidate {
    id: string;
    timestamp: number;
    priority: number;
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

        const sourceWorldState = await this.worldStateService.buildWorldState(session);
        const focus = deriveConversationFocus(stimulus, sourceWorldState);
        // Optional for older service adapters. The service validates raw sources and current scope.
        const stateService = this.worldStateService as WorldStateService & {
            getConversationState?: (session: AgentStimulus<any>["session"]) => Promise<{
                unknown: boolean;
                state?: { revision: number; topic?: string; openIssues: string[]; sourceMessageIds: string[]; createdAt: string; updatedAt: string };
            }>;
        };
        const working = await stateService.getConversationState?.(session);
        assertReplyTurn();
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

        let triggerContext: object = {};
        switch (type) {
            case "user_message":
                triggerContext = { isUserMessage: true, messageIds: (payload as UserMessagePayload).messageIds };
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
            return [{ type: "text", text: this.config.multiModalSystemTemplate }, ...multiModalData.images, { type: "text", text: userPromptText }];
        }

        return userPromptText;
    }

    /**
     * @description 构建多模态上下文。
     * 采用更声明式的方法来智能筛选图片，提高可读性和可维护性。
     * @param worldState 当前的世界状态
     * @returns 包含筛选后的图片内容的对象
     */
    private async buildMultimodalImages(worldState: WorldState): Promise<{ images: Array<ImagePart | TextPart> }> {
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
        for (const candidate of sortedUniqueCandidates) {
            if (finalImageIds.size >= this.config.maxImagesInContext) break;

            const usageCount = this.imageLifecycleTracker.get(candidate.id) || 0;
            if (usageCount < this.config.imageLifecycleCount) {
                finalImageIds.add(candidate.id);
                this.imageLifecycleTracker.set(candidate.id, usageCount + 1);
            }
        }

        // 5. 获取图片数据并格式化输出
        if (finalImageIds.size === 0) {
            return { images: [] };
        }

        const imageDataResults = await Promise.all(Array.from(finalImageIds).map((id) => this.assetService.getInfo(id)));

        const finalImages: Array<ImagePart | TextPart> = [];
        const allowedImageTypes = new Set(this.config.allowedImageTypes);

        for (const result of imageDataResults) {
            if (result && allowedImageTypes.has(result.mime)) {
                const imageBuffer = await this.assetService.read(result.id, {
                    format: "data-url",
                    image: { process: true, format: "jpeg" },
                });
                // 为LLM提供更明确的图片标识
                finalImages.push({ type: "text", text: `The following is an image with ID #${result.id}:` });
                finalImages.push({
                    type: "image_url",
                    image_url: { url: imageBuffer as string, detail: this.config.detail },
                });
            }
        }

        return { images: finalImages };
    }
}
