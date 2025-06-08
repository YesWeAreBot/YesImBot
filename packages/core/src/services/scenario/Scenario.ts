import { $, Context, Element, Session, h } from "koishi";
import { message, type Part, type TextPart, type UserMessagePart } from "../../dependencies/xsai";
import { ChatMessage, Interaction, LAST_REPLY_TABLE, MESSAGE_TABLE, INTERACTION_TABLE } from "../../types/model";
import { ImageProcessor, getChannelType, formatDate } from "../../utils";
import { PlatformAdapter, OneBotPlatform, DefaultPlatform } from "../PlatformAdapter";
import { Message, ConversationSummary } from "./types";

const { textPart } = message;

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
 * 统一的场景类，管理对话上下文和状态
 */
export class Scenario {
    public readonly id: string;
    public metadata: Record<string, string> = {};
    public summary: ConversationSummary | null = null; // 由 ContextProcessor 生成的摘要

    private messages: Message[] = []; // 已处理的消息
    private pendingMessages: Message[] = []; // 待处理的新消息

    private recallSize: number = 0;
    private lastReplyTime: Date | null = null;
    private platformAdapter: PlatformAdapter;
    private imageProcessor: ImageProcessor;

    constructor(
        public readonly ctx: Context,
        public readonly session: Session,
        private readonly limit: number = 30,
        private readonly multimodalConfig: MultimodalConfig
    ) {
        this.id = session.channelId;
        this.imageProcessor = new ImageProcessor(ctx);
        this.platformAdapter = this.createPlatformAdapter(session);
    }

    private createPlatformAdapter(session: Session): PlatformAdapter {
        switch (session.platform) {
            case "onebot":
                return new OneBotPlatform(session);
            default:
                return new DefaultPlatform(session);
        }
    }

    /**
     * 判断场景是否有新消息，是否活跃
     */
    get isActive(): boolean {
        return this.pendingMessages.length > 0;
    }

    /**
     * 异步加载初始数据
     */
    async load(): Promise<void> {
        this.messages = [];
        this.pendingMessages = [];

        const [lastReplyEntry] = await this.ctx.database.get(LAST_REPLY_TABLE, { channelId: this.id });
        this.lastReplyTime = lastReplyEntry ? lastReplyEntry.timestamp : null;

        await this.loadHistoricalData();
        await this.loadMetadata();
    }

    private async loadHistoricalData(): Promise<void> {
        const dbMessages = await this.ctx.database
            .select(MESSAGE_TABLE)
            .where({ channel: { id: this.id } })
            .orderBy("timestamp", "desc")
            .execute();
        const messagesToLoad = dbMessages.filter((m) => m.messageId !== this.session.messageId).slice(0, this.limit);

        const messageIds = messagesToLoad.map((m) => m.messageId);
        const interactions = await this.ctx.database
            .select(INTERACTION_TABLE)
            .where((row) => $.and($.eq(row.emitter_channel_id, this.id), $.gt(row.life, 0), $.in(row.emitter, messageIds)))
            .orderBy("timestamp", "asc")
            .execute();

        const history = [...messagesToLoad.reverse(), ...interactions];
        history.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        this.recallSize = Math.max(0, dbMessages.length - messagesToLoad.length);

        for (const record of history) {
            const isPending = this.lastReplyTime ? record.timestamp.getTime() > this.lastReplyTime.getTime() : true;
            this.addMessage(record, isPending, true);
        }
    }

    private async loadMetadata(): Promise<void> {
        try {
            this.metadata = await this.getMetaData();
        } catch (error: any) {
            this.ctx.logger.warn(`获取场景元数据失败 ${this.id}: ${error.message}`);
            this.metadata = {};
        }
    }

    private async getMetaData(): Promise<Record<string, string>> {
        const channelType = getChannelType(this.session.channelId);
        let metadata: Record<string, string> = {};

        switch (channelType) {
            case "guild":
                const groupInfo = await this.platformAdapter.getGroupInfo(this.session.guildId);
                metadata = { ...metadata, ...groupInfo };
                break;
            case "private":
                const userInfo = await this.platformAdapter.getUserInfo(this.session.userId);
                metadata = { ...metadata, ...userInfo };
                break;
        }
        return metadata;
    }

    /**
     * 添加消息到场景
     */
    public addMessage(message: Message, isPending = true, isLoading = false): void {
        if (isPending) {
            this.pendingMessages.push(message);
        } else {
            if (this.messages.length >= this.limit) {
                this.messages.shift();
                if (!isLoading) {
                    this.recallSize++;
                }
            }
            this.messages.push(message);
        }
    }

    /**
     * 同步 Interaction 的生命周期，在内存中递减 life 并移除生命周期结束的 Interaction。
     * 这个方法由 ScenarioManager 在数据库操作后调用。
     */
    public syncAndPruneInteractions(): void {
        let prunedCount = 0;

        const processArray = (arr: (ChatMessage | Interaction)[]) => {
            const newArray: (ChatMessage | Interaction)[] = [];
            for (const record of arr) {
                if ((record as Interaction).functionName !== undefined) {
                    const interaction = record as Interaction;
                    interaction.life--;
                    if (interaction.life > 0) {
                        newArray.push(interaction);
                    } else {
                        prunedCount++;
                    }
                } else {
                    newArray.push(record);
                }
            }
            return newArray;
        };

        this.messages = processArray(this.messages);
        this.pendingMessages = processArray(this.pendingMessages);

        if (prunedCount > 0) {
            this.ctx.logger.debug(
                `[Scenario ${this.session.channelId}] Pruned ${prunedCount} expired interactions from in-memory context.`
            );
        }
    }

    /**
     * 将待处理消息提交到主消息历史中
     */
    public commitPendingMessages(): void {
        this.messages.push(...this.pendingMessages);
        this.pendingMessages = [];

        if (this.messages.length > this.limit) {
            this.recallSize += this.messages.length - this.limit;
            this.messages = this.messages.slice(-this.limit);
        }
    }

    /**
     * 获取所有消息
     */
    public getMessages(includePending = true): Message[] {
        return includePending ? [...this.messages, ...this.pendingMessages] : [...this.messages];
    }

    /**
     * 将新消息转移到已读历史中，并重置活跃状态。
     * 在机器人成功回复后调用。
     */
    public clearPendingMessages(): void {
        this.messages.push(...this.pendingMessages);
        this.pendingMessages = [];

        // 确保 chatHistory 不超过限制
        if (this.messages.length > this.limit) {
            this.messages = this.messages.slice(-this.limit);
        }
    }

    /**
     * 渲染场景内容
     */
    public async renderForPrompt(): Promise<Array<UserMessagePart>> {
        const promptParts: Array<UserMessagePart> = [];
        const channelType = getChannelType(this.session.channelId);
        // 收集并处理图片
        const allImages = await this.collectAllImages([...this.messages, ...this.pendingMessages]);
        const allowedImages = this.selectAllowedImages(allImages);
        const allowedImageSet = new Set(allowedImages.map((img) => this.getImageKey(img)));
        // 构建提示词
        this.appendTextPart(promptParts, `  <scenario id="${this.session.channelId}" type="${channelType}">`);

        // 添加元数据
        Object.entries(this.metadata).forEach(([key, value]) => {
            this.appendTextPart(promptParts, `    ${key.toUpperCase()}: ${value}`);
        });
        // 添加召回记忆信息
        this.appendTextPart(
            promptParts,
            `    ${this.recallSize} previous messages between you and the scenario are stored in recall memory (use functions to access them)`
        );
        // 渲染历史消息
        await this.renderChatHistory(promptParts, allowedImageSet);
        // 渲染新消息
        await this.renderNewMessages(promptParts, allowedImageSet);
        this.appendTextPart(promptParts, `  </scenario>`);
        return promptParts;
    }

    /**
     * 渲染聊天历史
     */
    protected async renderChatHistory(promptParts: UserMessagePart[], allowedImageSet: Set<string>): Promise<void> {
        if (this.messages.length > 0) {
            this.appendTextPart(promptParts, `    <recent_chat_history>`);
            for (const record of this.messages) {
                const parts = await this.formatContext(record, allowedImageSet);
                this.appendFormattedParts(promptParts, parts, 3);
            }
            this.appendTextPart(promptParts, `    </recent_chat_history>`);
        } else {
            this.appendTextPart(promptParts, `    <recent_chat_history>(No recent chat history available)</recent_chat_history>`);
        }
    }

    /**
     * 渲染新消息
     */
    protected async renderNewMessages(promptParts: UserMessagePart[], allowedImageSet: Set<string>): Promise<void> {
        if (this.isActive) {
            this.appendTextPart(promptParts, "    <new_messages>");
            for (const record of this.pendingMessages) {
                const parts = await this.formatContext(record, allowedImageSet);
                this.appendFormattedParts(promptParts, parts, 3);
            }
            this.appendTextPart(promptParts, "    </new_messages>");
        }
    }

    /**
     * 渲染场景为LLM的Prompt
     */
    public async render(): Promise<Array<UserMessagePart>> {
        const promptParts: Array<UserMessagePart> = [];
        const allMessages = this.getMessages(true);

        // 收集并处理图片
        const allImages = await this.collectAllImages(allMessages);
        const allowedImages = this.selectAllowedImages(allImages);
        const allowedImageSet = new Set(allowedImages.map((img) => this.getImageKey(img)));

        this.appendTextPart(promptParts, `  <scenario id="${this.id}" type="${getChannelType(this.id)}">`);

        // 渲染元数据
        Object.entries(this.metadata).forEach(([key, value]) => {
            this.appendTextPart(promptParts, `    ${key.toUpperCase()}: ${value}`);
        });

        // 添加召回记忆信息
        this.appendTextPart(
            promptParts,
            `    ${this.recallSize} previous messages between you and the scenario are stored in recall memory (use functions to access them)`
        );

        // 渲染上下文摘要
        this.renderSummary(promptParts);

        // 渲染历史消息
        await this.renderMessageHistory(
            promptParts,
            this.messages,
            allowedImageSet,
            "recent_chat_history",
            "No recent chat history available"
        );

        // 渲染新消息
        if (this.isActive) {
            await this.renderMessageHistory(promptParts, this.pendingMessages, allowedImageSet, "new_messages");
        }

        this.appendTextPart(promptParts, `    </scenario>`);
        return promptParts;
    }

    private renderSummary(promptParts: Array<UserMessagePart>): void {
        if (!this.summary) return;

        this.appendTextPart(promptParts, `    <context_briefing>`);
        this.appendTextPart(promptParts, `      <overall_summary>${this.summary.overallSummary}</overall_summary>`);
        if (this.summary.activeTopics.length > 0) {
            this.appendTextPart(promptParts, `      <active_topics>`);
            this.summary.activeTopics.forEach((topic) => {
                this.appendTextPart(promptParts, `        <topic title="${topic.topic}">`);
                this.appendTextPart(promptParts, `          <summary>${topic.summary}</summary>`);
                const participants = topic.participants.map((p) => `${p.name}<${p.id}>`).join(", ");
                this.appendTextPart(promptParts, `          <participants>${participants}</participants>`);
                this.appendTextPart(promptParts, `        </topic>`);
            });
            this.appendTextPart(promptParts, `      </active_topics>`);
        }
        this.appendTextPart(promptParts, `    </context_briefing>`);
    }

    private async renderMessageHistory(
        promptParts: UserMessagePart[],
        messages: Message[],
        allowedImageSet: Set<string>,
        tagName: string,
        emptyText?: string
    ): Promise<void> {
        this.appendTextPart(promptParts, `<${tagName}>`);
        if (messages.length > 0) {
            for (const record of messages) {
                const parts = await this.formatContext(record, allowedImageSet);
                this.appendFormattedParts(promptParts, parts, 3);
            }
        } else {
            this.appendTextPart(promptParts, emptyText);
        }
        this.appendTextPart(promptParts, `</${tagName}>`);
    }

    /**
     * 格式化上下文记录
     */
    protected async formatContext(record: ChatMessage | Interaction, allowedImageSet: Set<string>): Promise<UserMessagePart[]> {
        if ("functionName" in record) {
            return [textPart(this.formatInteraction(record as Interaction))];
        } else {
            return this.formatMessage(record as ChatMessage, allowedImageSet);
        }
    }

    /**
     * 格式化消息
     * @param message 消息对象
     * @param allowedImageSet 允许渲染的图片集合
     * @returns 格式化后的消息部分数组
     */
    protected async formatMessage(message: ChatMessage, allowedImageSet: Set<string>): Promise<UserMessagePart[]> {
        const parts: UserMessagePart[] = [];
        const date = formatDate(message.timestamp);
        const sender = this.formatSender(message);
        const prefix = `[#${message.messageId} ${date} ${sender}]`;
        const elements = h.parse(message.content as string);
        let currentTextContent = "";
        for (const elem of elements) {
            const processed = await this.processElement(elem, message.messageId, allowedImageSet);

            if (typeof processed === "string") {
                currentTextContent += processed;
            } else {
                // 如果有累积的文本，先添加
                if (currentTextContent) {
                    parts.push(textPart(currentTextContent));
                    currentTextContent = "";
                }
                parts.push(...processed);
            }
        }
        // 处理剩余文本
        if (currentTextContent) {
            parts.push(textPart(currentTextContent));
        }
        // 添加前缀
        if (parts.length > 0 && parts[0].type === "text") {
            (parts[0] as TextPart).text = `${prefix} ${(parts[0] as TextPart).text.trimStart()}`;
        } else {
            parts.unshift(textPart(prefix));
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
     */
    protected formatInteraction(interaction: Interaction): string {
        if (interaction.type === "tool_result") {
            return `[FUNCTION RETURN:${interaction.functionName}] ${JSON.stringify(interaction.toolResult)}`;
        } else {
            return `[FUNCTION CALL] ${JSON.stringify({
                function: interaction.functionName,
                params: interaction.toolParams,
            })}`;
        }
    }

    /**
     * 提取 sender 格式化逻辑为私有方法，避免重复
     * @param message 消息对象
     * @returns 格式化后的发送者字符串
     */
    private getSenderString(message: ChatMessage): string {
        const SELF_IDENTIFIER = "YOU"; // 用于标识机器人自身的标识符

        let sender = message.sender.id === this.session.bot.selfId ? SELF_IDENTIFIER : `${message.sender.name}<${message.sender.id}>`;
        if (message.sender.id !== this.session.bot.selfId && !message.sender.name && message.sender.nick) {
            if (message.sender.nick && message.sender.nick !== message.sender.name) {
                sender = `${message.sender.nick}(${message.sender.name})<${message.sender.id}>`;
            }
        }
        return sender;
    }

    /**
     * 处理元素
     */
    protected async processElement(elem: Element, messageId: string, allowedImageSet: Set<string>): Promise<string | UserMessagePart[]> {
        switch (elem.type) {
            case "text":
                return Element.escape(elem.attrs.content) || "";
            case "at":
                return h("at", elem.attrs).toString();
            case "quote":
                return `[引用#${elem.attrs.id}]`;
            case "img":
            case "image":
                return this.processImageElement(elem, messageId, allowedImageSet);
            default:
                return `[${elem.type}]`;
        }
    }

    /**
     * 格式化发送者
     */
    protected formatSender(message: ChatMessage): string {
        const isSelf = message.sender.id === this.session.bot.selfId;

        if (isSelf) {
            return "YOU";
        }
        let name = message.sender.name || message.sender.nick || message.sender.id;
        return `${name}<${message.sender.id}>`;
    }

    /**
     * 收集所有消息中的图片信息
     * @param records 消息或交互记录数组
     * @returns 图片信息数组，按时间排序（最新的在前）
     */
    protected async collectAllImages(records: (ChatMessage | Interaction)[]): Promise<ImageInfo[]> {
        const images: ImageInfo[] = [];
        for (const record of records) {
            if ("functionName" in record) continue;
            const message = record as ChatMessage;
            const elements = h.parse(message.content as string);
            for (const elem of elements) {
                if (elem.type === "img" || elem.type === "image") {
                    images.push({
                        element: elem,
                        timestamp: message.timestamp,
                        messageId: message.messageId,
                        imageId: elem.attrs.id,
                        imageUrl: elem.attrs.src || elem.attrs.url,
                    });
                }
            }
        }
        // 按时间倒序排序（最新的图片在前）
        return images.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }

    /**
     * 选择允许渲染的图片
     */
    protected selectAllowedImages(images: ImageInfo[]): ImageInfo[] {
        return images.slice(0, this.multimodalConfig.MaxImagesPerPrompt);
    }
    /**
     * 获取图片键值
     */
    protected getImageKey(image: ImageInfo): string {
        return `${image.messageId}-${image.imageId || image.imageUrl}`;
    }
    /**
     * 辅助方法：添加文本部分
     */
    protected appendTextPart(parts: UserMessagePart[], text: string): void {
        if (parts.length > 0 && parts[parts.length - 1].type === "text") {
            (parts[parts.length - 1] as TextPart).text += `\n${text}`;
        } else {
            parts.push(textPart(text));
        }
    }

    /**
     * 添加格式化的部分
     */
    protected appendFormattedParts(parts: UserMessagePart[], newParts: UserMessagePart[], indentLevel: number): void {
        const indent = "  ".repeat(indentLevel);

        for (const part of newParts) {
            if (part.type === "text") {
                this.appendTextPart(parts, indent + (part as TextPart).text);
            } else {
                parts.push(part);
            }
        }
    }
}
