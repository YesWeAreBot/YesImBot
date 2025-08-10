import { Services } from "@/shared/constants";
import { ImagePart, TextPart } from "@xsai/shared-chat";
import { Context, Logger } from "koishi";

import { AssetService } from "@/services/assets";
import { ToolService } from "@/services/extension";
import { MemoryService } from "@/services/memory";
import { ChatModelSwitcher } from "@/services/model";
import { AgentStimulus, ContextualMessage, L1HistoryItem, UserMessagePayload, WorldState, WorldStateService } from "@/services/worldstate";
import { AgentBehaviorConfig } from "./config";

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
    private imageLifecycleTracker = new Map<string, number>();

    constructor(
        private readonly ctx: Context,
        private readonly config: AgentBehaviorConfig,
        private readonly modelSwitcher: ChatModelSwitcher
    ) {
        this.logger = ctx[Services.Logger].getLogger("[上下文构建器]");
        this.assetService = ctx[Services.Asset];
        this.memoryService = ctx[Services.Memory];
        this.toolService = ctx[Services.Tool];
        this.worldStateService = ctx[Services.WorldState];
    }

    /**
     * 构建完整的上下文对象，用于渲染提示词模板。
     */
    public async build(stimulus: AgentStimulus<any>) {
        const { type, session, payload } = stimulus;

        // 1. 从 WorldStateService 获取已经包含 L1, L2, L3 记忆的 WorldState
        const worldState = await this.worldStateService.buildWorldState(session);

        // 2. 预处理 L1 记忆，添加用于模板渲染的字段
        const processedL1History = this.preprocessL1History(worldState.l1_working_memory);

        // 3. 将处理过的 L1 记忆分割为"已读"和"新"两部分
        const { processed_events, new_events } = this.partitionL1History(processedL1History);
        worldState.l1_working_memory = undefined; // 清理掉原始数据，避免混淆
        (worldState as any).processed_events = processed_events;
        (worldState as any).new_events = new_events;

        // 4. 构建并附加触发上下文
        let triggerContext: object = {};
        switch (type) {
            case "user_message":
                triggerContext = { isUserMessage: true, messageIds: (payload as UserMessagePayload).messageIds };
                break;
            case "system_event":
                triggerContext = { isSystemEvent: true, event: payload };
                break;
        }
        worldState.triggerContext = triggerContext;

        // 5. 返回最终的上下文对象
        return {
            toolSchemas: this.toolService.getToolSchemas(),
            memoryBlocks: await this.memoryService.getMemoryBlocksForRendering(),
            worldState: worldState,
        };
    }

    /**
     * 为 L1 历史记录中的每个项目添加用于渲染的辅助字段。
     */
    private preprocessL1History(history: L1HistoryItem[]) {
        // No longer needed to add fields here, but keeping the method for structure.
        // The partitioning logic will handle the raw items.
        return history;
    }

    /**
     * 将预处理过的 L1 历史记录分割为"已处理"和"新"两部分。
     */
    private partitionL1History(history: L1HistoryItem[]) {
        const processed_events: any[] = [];
        const new_events: any[] = [];
        const firstNewIndex = history.findIndex((item) => item.is_new);

        if (firstNewIndex === -1) {
            processed_events.push(...history);
        } else {
            processed_events.push(...history.slice(0, firstNewIndex));
            new_events.push(...history.slice(firstNewIndex));
        }
        return { processed_events, new_events };
    }

    /**
     * 构建多模态消息内容，如果模型和配置支持。
     * @returns 包含图片和文本的消息内容数组，或纯文本字符串。
     */
    public async buildMultimodalUserMessage(userPromptText: string, worldState: WorldState): Promise<string | (ImagePart | TextPart)[]> {
        const canUseVision = this.modelSwitcher.hasVisionCapability() && this.config.vision.enabled;
        if (!canUseVision) {
            return userPromptText;
        }

        const multiModalData = await this.buildMultimodalImages(worldState);
        if (multiModalData.images.length > 0) {
            this.logger.debug(`上下文包含 ${multiModalData.images.length / 2} 张图片，将构建多模态消息。`);
            return [
                { type: "text", text: this.config.prompt.multiModalSystemTemplate },
                ...multiModalData.images,
                { type: "text", text: userPromptText },
            ];
        }

        return userPromptText;
    }

    /**
     * @description 构建多模态上下文。
     * 采用更声明式的方法来智能筛选图片，提高可读性和可维护性。
     * @param worldState 当前的世界状态
     * @returns 包含筛选后的图片内容的对象
     */
    private async buildMultimodalImages(worldState: WorldState): Promise<{ images: (ImagePart | TextPart)[] }> {
        // ... 原来的 buildMultimodalContext 的全部逻辑 ...

        // 1. 将所有消息扁平化并建立索引
        const allMessages = (worldState.l1_working_memory || []).filter(
            (item): item is { type: "message" } & ContextualMessage => item.type === "message"
        );
        const messageMap = new Map(allMessages.map((m) => [m.id, m]));

        const imageTags = ["img", "image"];

        // 2. 收集所有潜在的图片候选者，并赋予优先级
        const imageCandidates: ImageCandidate[] = allMessages.flatMap((msg) => {
            const elements = msg.elements;
            const imageIds = elements.filter((e) => imageTags.includes(e.type) && e.attrs.id).map((e) => e.attrs.id as string);

            // 检查引用，为被引用的图片赋予更高优先级
            let isQuotedImage = false;
            if (msg.quoteId && messageMap.has(msg.quoteId)) {
                const quotedElements = messageMap.get(msg.quoteId).elements;
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

        const imageDataResults = await Promise.all(Array.from(finalImageIds).map((id) => this.assetService.getInfo(id)));

        const finalImages: (ImagePart | TextPart)[] = [];
        const allowedImageTypes = new Set(this.config.vision.allowedImageTypes);

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
                    image_url: { url: imageBuffer as string, detail: this.config.vision.detail },
                });
            }
        }

        return { images: finalImages };
    }
}
