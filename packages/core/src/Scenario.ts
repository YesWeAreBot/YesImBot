import { $, Context, Element, h, Session } from "koishi";
import { DefaultPlatform, OneBotPlatform, PlatformAdapter } from "./services/PlatformAdapter";
import { Interaction, INTERACTION_TABLE, LAST_REPLY_TABLE, Message, MESSAGE_TABLE } from "./types/model";
import { formatDate, getChannelType, ImageProcessor } from "./utils";
import type { Part, TextPart, UserMessagePart } from "xsai";
import { message } from "./dependencies/xsai";

const { textPart, imagePart } = message;

// 定义多模态配置接口
export interface MultimodalConfig {
    Enabled: boolean;
    ImageDetail: "low" | "high" | "auto";
    MaxImagesPerPrompt: number; // 整个 prompt 中允许的最大图片数量
}

// 图片信息接口，用于图片处理和排序
interface ImageInfo {
    element: Element;
    timestamp: Date;
    messageId: string;
    imageId?: string;
    imageUrl?: string;
}

/**
 * 对话场景
 */
export class Scenario {
    private metadata: Record<string, string>;
    public chatHistory: (Message | Interaction)[] = []; // 已读消息列表
    public newMessages: (Message | Interaction)[] = []; // 未读消息列表
    private recallSize: number; // 数据库中超出上下文限制，但仍可"召回"的历史记录数量
    private lastReplyTime: Date | null = null; // 存储最后回复时间，用于判断消息已读状态
    private platformAdapter: PlatformAdapter;

    private multimodalConfig: MultimodalConfig;
    private imageProcessor: ImageProcessor;

    constructor(private ctx: Context, private session: Session, private limit: number = 30, multimodalConfig: MultimodalConfig) {
        switch (session.platform) {
            case "onebot":
                this.platformAdapter = new OneBotPlatform(session);
                break;
            default:
                this.platformAdapter = new DefaultPlatform(session);
                break;
        }

        this.imageProcessor = new ImageProcessor(ctx);

        // 默认不启用多模态
        this.multimodalConfig = Object.assign({ enabled: false, imageDetail: "low", maxImagesPerPrompt: 0 }, multimodalConfig);
    }

    /**
     * 判断群组是否活跃（有未读消息）
     */
    public get isActive(): boolean {
        return this.newMessages.length > 0;
    }

    /**
     * 异步加载初始数据 (仅在 Scenario 首次创建时调用一次)
     * 合并查询消息和交互，减少数据库查询。
     * @param limit 历史消息数量限制
     */
    public async loadInitialData() {
        // 初始化并清空上下文
        this.chatHistory = [];
        this.newMessages = [];

        // 1. 获取最后回复时间
        const [lastReplyEntry] = await this.ctx.database.get(LAST_REPLY_TABLE, { channelId: this.session.channelId });
        this.lastReplyTime = lastReplyEntry ? lastReplyEntry.timestamp : null;

        // 2. 批量查询消息和交互
        const messages = await this.ctx.database
            .select(MESSAGE_TABLE)
            .where({ channel: { id: this.session.channelId } })
            .orderBy("timestamp", "desc")
            .execute();

        const chatMessagesToLoad = messages.filter((m) => m.messageId !== this.session.messageId).slice(0, this.limit);

        const messageIds = chatMessagesToLoad.map((m) => m.messageId);

        const chatInteractions = await this.ctx.database
            .select(INTERACTION_TABLE)
            .where((row) => $.and($.eq(row.emitter_channel_id, this.session.channelId), $.gt(row.life, 0), $.in(row.emitter, messageIds)))
            .orderBy("timestamp", "asc")
            .execute();

        // 合并消息和交互并按时间排序
        let history: (Interaction | Message)[] = [...chatMessagesToLoad.reverse(), ...chatInteractions];
        history.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        // 计算超出上下文限制的记忆数量
        const totalHistoricalMessagesCountInDb = (
            await this.ctx.database
                .select(MESSAGE_TABLE)
                .where({ channel: { id: this.session.channelId } })
                .execute()
        ).length;

        this.recallSize = Math.max(0, totalHistoricalMessagesCountInDb - chatMessagesToLoad.length);

        for (const record of history) {
            // 根据 lastReplyTime 判断是否是新消息
            const isNewMessage = this.lastReplyTime ? record.timestamp.getTime() > this.lastReplyTime.getTime() : true;
            this.addContext(record, isNewMessage, true);
        }

        // 初始化场景名称和描述
        try {
            this.metadata = await this.getMetaData();
        } catch (error: any) {
            this.ctx.logger.warn(`Failed to get scenario metadata for ${this.session.channelId}: ${error.message}`);
            this.metadata = {};
        }
    }

    /**
     * 添加消息或交互到 Scenario 的上下文。
     * @param record 消息或交互对象
     * @param isNewMessage 是否是新消息
     * @param isLoadingInitialData 标记是否在初始加载数据，避免在加载时错误增加 recallSize
     */
    public addContext(record: Message | Interaction, isNewMessage = true, isLoadingInitialData = false) {
        if (isNewMessage) {
            this.newMessages.push(record);
        } else {
            if (this.chatHistory.length > this.limit) {
                const shiftedItem = this.chatHistory.shift(); // 移除最早的消息或交互
                // Only increment recallSize if a MESSAGE was shifted out during non-initial load
                // And if we are not in the initial loading phase (recallSize is set once there)
                if (!isLoadingInitialData && shiftedItem && (shiftedItem as Message).messageId) {
                    // This logic for recallSize might be tricky if interactions are also shifted.
                    // recallSize is primarily for messages.
                }
                this.recallSize++;
            }
            this.chatHistory.push(record);
        }
    }

    /**
     * 同步 Interaction 的生命周期，在内存中递减 life 并移除生命周期结束的 Interaction。
     * 这个方法由 ScenarioManager 在数据库操作后调用。
     */
    public syncAndPruneInteractions(): void {
        let prunedCount = 0;

        // Helper function to process an array (context or unread)
        const processArray = (arr: (Message | Interaction)[]) => {
            const newArray: (Message | Interaction)[] = [];
            for (const record of arr) {
                if ((record as Interaction).functionName !== undefined) {
                    // It's an Interaction
                    const interaction = record as Interaction;
                    interaction.life--; // Decrement life in memory
                    if (interaction.life > 0) {
                        newArray.push(interaction);
                    } else {
                        prunedCount++; // Count how many were pruned
                    }
                } else {
                    newArray.push(record); // It's a Message, keep it
                }
            }
            return newArray;
        };

        this.chatHistory = processArray(this.chatHistory);
        this.newMessages = processArray(this.newMessages);

        if (prunedCount > 0) {
            this.ctx.logger.debug(
                `[Scenario ${this.session.channelId}] Pruned ${prunedCount} expired interactions from in-memory context.`
            );
        }
    }

    /**
     * 清空上下文
     */
    public clearContext() {
        this.chatHistory = [];
        this.newMessages = [];
    }

    /**
     * 将新消息转移到已读历史中，并重置活跃状态。
     * 在机器人成功回复后调用。
     */
    public clearNewMessages(): void {
        this.chatHistory.push(...this.newMessages);
        this.newMessages = [];

        // 确保 chatHistory 不超过限制
        if (this.chatHistory.length > this.limit) {
            this.chatHistory = this.chatHistory.slice(-this.limit);
        }
    }

    /**
     * 获取场景元数据
     */
    private async getMetaData(): Promise<Record<string, string>> {
        let metadata: Record<string, string> = {};
        switch (getChannelType(this.session.channelId)) {
            case "guild":
                const groupInfo = await this.platformAdapter.getGroupInfo(this.session.guildId);
                metadata = {
                    ...metadata,
                    ...groupInfo,
                };
                break;
            case "private":
                const userInfo = await this.platformAdapter.getUserInfo(this.session.userId);
                metadata = {
                    ...metadata,
                    ...userInfo,
                };
                break;
            case "sandbox":
            default:
                break;
        }
        return metadata;
    }

    /**
     * 收集所有消息中的图片信息
     * @param records 消息或交互记录数组
     * @returns 图片信息数组，按时间排序（最新的在前）
     */
    private async collectAllImages(records: (Message | Interaction)[]): Promise<ImageInfo[]> {
        const allImages: ImageInfo[] = [];

        for (const record of records) {
            // 跳过交互记录，只处理消息
            if ((record as Interaction).functionName !== undefined) {
                continue;
            }

            const message = record as Message;
            const elements = h.parse(message.content as string);

            for (const elem of elements) {
                if (elem.type === "img" || elem.type === "image") {
                    const imageId = elem.attrs.id;
                    const imageUrl = elem.attrs.src || elem.attrs.url;

                    if (imageId || imageUrl) {
                        allImages.push({
                            element: elem,
                            timestamp: message.timestamp,
                            messageId: message.messageId,
                            imageId,
                            imageUrl,
                        });
                    }
                }
            }
        }

        // 按时间倒序排序（最新的图片在前）
        allImages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        return allImages;
    }

    /**
     * 渲染此 Scenario 实例的上下文，供 PromptBuilder 使用。
     * 未读消息会被单独列出，并提示 AI 数量。
     * @returns {Array<Part>} 包含 TextPart 和 ImagePart 的数组
     */
    public async renderForPrompt(): Promise<Array<UserMessagePart>> {
        const INDENT_UNIT = "  "; // 2 spaces
        const promptParts: Array<UserMessagePart> = [];

        // 收集所有图片并确定哪些图片可以渲染
        const allRecords = [...this.chatHistory, ...this.newMessages];
        const allImages = await this.collectAllImages(allRecords);
        const allowedImages = allImages.slice(0, this.multimodalConfig.MaxImagesPerPrompt);
        const allowedImageSet = new Set(allowedImages.map((img) => `${img.messageId}-${img.imageId || img.imageUrl}`));

        // 辅助函数：将文本添加到 promptParts 数组，并尝试合并连续的 TextPart
        const appendTextPart = (text: string) => {
            if (promptParts.length > 0 && promptParts[promptParts.length - 1].type === "text") {
                (promptParts[promptParts.length - 1] as TextPart).text += `\n${text}`;
            } else {
                promptParts.push(message.textPart(text));
            }
        };

        const channelType = getChannelType(this.session.channelId);

        appendTextPart(INDENT_UNIT + `<scenario id="${this.session.channelId}" type="${channelType}">`);
        Object.keys(this.metadata).forEach((k) => {
            appendTextPart(INDENT_UNIT.repeat(2) + `${k.toUpperCase()}: ${this.metadata[k]}`);
        });

        appendTextPart(
            INDENT_UNIT.repeat(2) +
                `${this.recallSize} previous messages between you and the scenario are stored in recall memory (use functions to access them)`
        );

        // Recent Chat History
        if (this.chatHistory.length > 0) {
            appendTextPart(INDENT_UNIT.repeat(2) + `<recent_chat_history>`);
            for (const record of this.chatHistory) {
                const formattedRecordParts = await this.formatContext(record, allowedImageSet);
                for (const part of formattedRecordParts) {
                    if (part.type === "text") {
                        // 为历史消息的文本添加额外缩进
                        appendTextPart(INDENT_UNIT.repeat(3) + (part as TextPart).text);
                    } else if (part.type === "image_url") {
                        promptParts.push(part); // 图片直接推入，不加缩进
                    }
                }
            }
            appendTextPart(INDENT_UNIT.repeat(2) + `</recent_chat_history>`);
        } else {
            appendTextPart(INDENT_UNIT.repeat(2) + `<recent_chat_history>(No recent chat history available)</recent_chat_history>`);
        }

        // New Messages
        if (this.isActive) {
            appendTextPart(INDENT_UNIT.repeat(2) + "<new_messages>");
            for (const record of this.newMessages) {
                const formattedRecordParts = await this.formatContext(record, allowedImageSet);
                for (const part of formattedRecordParts) {
                    if (part.type === "text") {
                        // 为新消息的文本添加额外缩进
                        appendTextPart(INDENT_UNIT.repeat(3) + (part as TextPart).text);
                    } else if (part.type === "image_url") {
                        promptParts.push(part); // 图片直接推入，不加缩进
                    }
                }
            }
            appendTextPart(INDENT_UNIT.repeat(2) + "</new_messages>");
        }

        appendTextPart(INDENT_UNIT + `</scenario>`);

        return promptParts;
    }

    /**
     * 格式化消息或交互，返回包含 TextPart 和 ImagePart 的数组
     * @param record 消息或交互对象
     * @param allowedImageSet 允许渲染的图片集合
     * @returns {Array<Part>} 格式化后的内容 Part 数组
     */
    private async formatContext(record: Message | Interaction, allowedImageSet: Set<string>): Promise<UserMessagePart[]> {
        if ((record as Interaction).functionName !== undefined) {
            return [message.textPart(this.formatInteraction(record as Interaction))]; // 交互始终是文本
        } else {
            return this.formatMessage(record as Message, allowedImageSet);
        }
    }

    /**
     * 格式化单条消息
     * @param message 消息对象
     * @param allowedImageSet 允许渲染的图片集合
     * @returns 格式化后的消息部分数组
     */
    private async formatMessage(message: Message, allowedImageSet: Set<string>): Promise<Array<UserMessagePart>> {
        const parts: Array<UserMessagePart> = [];
        let currentTextContent: string = ""; // 累积当前文本内容，直到遇到图片或消息结束

        const date = formatDate(message.timestamp);
        const senderString = this.getSenderString(message);
        const prefix = `[#${message.messageId} ${date} ${senderString}]`;

        const elements = h.parse(message.content as string);

        for (const elem of elements) {
            switch (elem.type) {
                case "quote":
                    currentTextContent += `[引用#${elem.attrs.id}]`;
                    break;
                case "text":
                    currentTextContent += Element.escape(elem.attrs.content) || "";
                    break;
                case "img":
                case "image":
                    const processedImageParts = await this.processImageElement(elem, message.messageId, allowedImageSet);

                    // 如果有累积的文本内容，先将其作为 TextPart 推入
                    if (currentTextContent.length > 0) {
                        parts.push(textPart(currentTextContent));
                        currentTextContent = ""; // 重置累积文本
                    }

                    // 添加图片处理结果
                    parts.push(...processedImageParts);
                    break;
                case "at":
                    currentTextContent += h("at", elem.attrs);
                    break;
                case "face":
                    currentTextContent += `[表情:${elem.attrs.id}]`;
                    break;
                case "video":
                case "audio":
                case "file":
                    currentTextContent += `[${elem.type}]`;
                    break;
                default:
                    currentTextContent += `[${elem.type}]`;
                    break;
            }
        }

        // 处理剩余的文本内容
        if (currentTextContent.length > 0) {
            parts.push(textPart(currentTextContent));
        }

        // 添加统一的前缀到第一个文本部分，或在完全没有文本（只有图片）时创建前缀部分
        if (parts.length > 0 && parts[0].type === "text") {
            (parts[0] as TextPart).text = `${prefix} ${(parts[0] as TextPart).text.trimStart()}`; // trimStart避免前缀后的多余空格
        } else if (parts.length > 0 && parts[0].type === "image_url") {
            // 如果消息以图片开始，在图片前插入一个包含前缀的TextPart
            parts.unshift(textPart(prefix));
        } else if (parts.length === 0) {
            // 极端情况：消息内容解析后为空，补一个带前缀的空文本部分
            parts.push(textPart(`${prefix} (Empty message content)`));
        }

        return parts;
    }

    /**
     * 处理图片元素，根据是否在允许渲染的集合中返回相应的部分
     * @param elem 图片元素
     * @param messageId 消息ID
     * @param allowedImageSet 允许渲染的图片集合
     * @returns 图片处理结果部分数组
     */
    private async processImageElement(elem: Element, messageId: string, allowedImageSet: Set<string>): Promise<UserMessagePart[]> {
        const imageId = elem.attrs.id;
        const imageUrl = elem.attrs.src || elem.attrs.url;

        if (!imageId && !imageUrl) {
            return [textPart(`[图片]`)];
        }

        const imageKey = `${messageId}-${imageId || imageUrl}`;
        const shouldRenderAsImage = this.multimodalConfig.Enabled && allowedImageSet.has(imageKey);

        if (shouldRenderAsImage) {
            const base64 = await this.imageProcessor.getBase64(imageId);

            if (!base64 && !imageUrl) {
                return [textPart(`[图片]`)];
            }

            return [
                textPart("[图片 "),
                {
                    type: "image_url",
                    image_url: {
                        url: base64 || imageUrl,
                        detail: this.multimodalConfig.ImageDetail,
                    },
                },
                textPart("]"),
            ];
        } else {
            // 回退到文本表示：多模态未启用，或图片超出限制
            return [textPart(`[图片 #${imageId || "URL"}]`)];
        }
    }

    /**
     * 格式化交互记录
     * @param interaction 交互对象
     * @returns 格式化后的交互文本
     */
    private formatInteraction(interaction: Interaction): string {
        if (interaction.type === "tool_result") {
            const serializedResult = JSON.stringify(interaction.toolResult);
            return `[FUNCTION RETURN:${interaction.functionName}] ${serializedResult}`;
        } else {
            const serializedParams = JSON.stringify({
                function: interaction.functionName,
                params: interaction.toolParams,
            });
            return `[FUNCTION CALL] ${serializedParams}`;
        }
    }

    /**
     * 提取 sender 格式化逻辑为私有方法，避免重复
     * @param message 消息对象
     * @returns 格式化后的发送者字符串
     */
    private getSenderString(message: Message): string {
        const SELF_IDENTIFIER = "YOU"; // 用于标识机器人自身的标识符

        let sender = message.sender.id === this.session.bot.selfId ? SELF_IDENTIFIER : `${message.sender.name}<${message.sender.id}>`;
        if (message.sender.id !== this.session.bot.selfId && !message.sender.name && message.sender.nick) {
            if (message.sender.nick && message.sender.nick !== message.sender.name) {
                sender = `${message.sender.nick}(${message.sender.name})<${message.sender.id}>`;
            }
        }
        return sender;
    }
}
