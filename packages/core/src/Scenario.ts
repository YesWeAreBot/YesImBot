import { $, Context, h, Session } from "koishi";
import type { ImagePart, TextPart } from "xsai";

import { DefaultPlatform, OneBotPlatform, PlatformAdapter } from "./services/PlatformAdapter";
import { Interaction, INTERACTION_TABLE, LAST_REPLY_TABLE, Message, MESSAGE_TABLE } from "./types/model";
import { formatDate, getChannelType } from "./utils";


/**
 * 对话场景
 */
export class Scenario {

    private metadata: Record<string, string>;
    private context: (Message | Interaction)[] = []; // 已读消息列表
    private unread: (Message | Interaction)[] = [];  // 未读消息列表
    private recallSize: number;
    private lastReplyTime: Date | null = null; // 存储最后回复时间，用于判断消息已读状态
    private platformAdapter: PlatformAdapter

    constructor(private ctx: Context, private session: Session) {
        switch (session.platform) {
            case 'onebot':
                this.platformAdapter = new OneBotPlatform(session);
                break;
            default:
                this.platformAdapter = new DefaultPlatform(session);
                break;
        }
    }

    /**
     * 异步加载初始数据 (仅在 Scenario 首次创建时调用一次)
     * 合并查询消息和交互，减少数据库查询。
     * @param limit 历史消息数量限制
     */
    public async loadInitialData(limit: number = 30) {
        this.context = [];
        this.unread = [];

        // 1. 获取最后回复时间
        const [lastReplyEntry] = await this.ctx.database.get(LAST_REPLY_TABLE, { channelId: this.session.channelId });
        this.lastReplyTime = lastReplyEntry ? lastReplyEntry.timestamp : null;

        // 2. 批量查询消息和交互
        const messages = await this.ctx.database
            .select(MESSAGE_TABLE)
            .where({ channel: { id: this.session.channelId } })
            .orderBy("timestamp", "desc")
            .execute();


        // 删除最后一条消息避免重复添加
        messages.shift();

        const chatMessages = messages.splice(0, limit);

        const messageIds = chatMessages.map(m => m.messageId);

        // 获取与这些消息相关的交互
        const chatInteractions = await this.ctx.database
            .select(INTERACTION_TABLE)
            .where(row => $.in(row.emitter, messageIds))
            .execute();

        // 合并消息和交互并按时间排序
        let history: (Interaction | Message)[] = [...chatMessages, ...chatInteractions];
        history.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        // 计算超出上下文限制的记忆数量
        this.recallSize = Math.max(0, messages.length)

        for (const record of history) {
            // 根据 lastReplyTime 判断是否为已读
            const isRead = this.lastReplyTime ? record.timestamp.getTime() <= this.lastReplyTime.getTime() : false;
            this.addContext(record, isRead); // 使用重载的 addContext 方法
        }

        // 初始化场景名称和描述
        this.metadata = await this.getMetaData();
    }

    /**
     * 添加消息或交互到 Scenario 的上下文。
     * @param record 消息或交互对象
     * @param isRead 是否为已读（机器人视角）
     */
    public addContext(record: Message | Interaction, isRead = false) {
        const arr = isRead ? this.context : this.unread;
        arr.push(record);
    }

    /**
     * 清空 Scenario 上下文和未读消息。
     */
    public clearContext() {
        this.context = [];
        this.unread = [];
    }

    /**
     * 获取场景元数据
     */
    private async getMetaData(): Promise<Record<string, string>> {
        let metadata = {};
        switch (getChannelType(this.session.channelId)) {
            case "guild":
                const groupInfo = await this.platformAdapter.getGroupInfo(this.session.guildId);
                metadata = {
                    ...metadata,
                    ...groupInfo,
                }
                break;
            case "private":
                const userInfo = await this.platformAdapter.getUserInfo(this.session.channelId);
                metadata = {
                    ...metadata,
                    ...userInfo,
                }
                break;
            case "sandbox":
            default:
                break;
        }
        return metadata;
    }

    /**
     * 将场景渲染为字符串，用于 LLM 提示词。
     * 未读消息会被单独列出，并提示 AI 数量。
     */
    public render(): string | (TextPart | ImagePart)[] {
        let output = [
            `<scenario id="${this.session.channelId}" type="${getChannelType(this.session.channelId)}">`,
            Object.keys(this.metadata).map(k => `${k}: ${this.metadata[k]}`).join("\n"),
            `${this.recallSize} previous messages between you and the scenario are stored in recall memory (use functions to access them)`,
            "",
            `Chat History:`,
            ...this.context.map(this.formatContext),
            "",
            `You have ${this.unread.length} new messages to read:`,
            ...this.unread.map(this.formatContext),
            `</scenario>`
        ].join("\n");

        // 渲染后，将未读消息移至已读消息列表，并清空未读列表
        // 数据库中 last_reply_table 的更新由 LLMProcessingMiddleware 负责
        for (const message of this.unread) {
            this.context.push(message);
        }
        this.unread = [];
        return output;
    }

    private formatContext(record: Message | Interaction): string {
        if ((record as Message).messageId) {
            // 如果是 Message 类型
            return this.formatMessage(record as Message);
        } else {
            // 如果是 Interaction 类型
            return this.formatInteraction(record as Interaction);
        }
    }

    private formatMessage(message: Message): string {
        let elements = h.parse(message.content as string);
        let content = "";
        for (let elem of elements) {
            switch (elem.type) {
                case "text":
                    content += elem.attrs.content;
                    break;
                case "img":
                    content += elem.attrs.summary || `[图片]`;
                    break;
                case "at":
                    content += `<at id="${elem.attrs.id}" name="@${elem.attrs.name}"/>`
                    break;
                default:
                    content += `[${elem.type}]`;
                    break;
            }
        }

        if (message.sender.id === this.session.bot.selfId) {
            return `[#${message.messageId} ${formatDate(message.timestamp)} YOU] ${content}`;
        } else {
            return `[#${message.messageId} ${formatDate(message.timestamp)} ${message.sender.name}<${message.sender.id}>] ${content}`;
        }
    }

    private formatInteraction(interaction: Interaction): string {
        if (interaction.type === "tool_result") {
            return `[FUNCTION RETURN] ${JSON.stringify(interaction.content)}`;
        } else {
            return `[FUNCTION CALL] ${JSON.stringify(interaction.content)}`;
        }
    }
}
