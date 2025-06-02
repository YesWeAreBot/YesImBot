import { $, Context, h, Session } from "koishi";
import type { ImagePart, TextPart } from "xsai";

import { DefaultPlatform, OneBotPlatform, PlatformAdapter } from "./services/PlatformAdapter";
import { Interaction, INTERACTION_TABLE, LAST_REPLY_TABLE, Message, MESSAGE_TABLE } from "./types/model";
import { formatDate, getChannelType, isEmpty, isNotEmpty } from "./utils";

/**
 * 对话场景
 */
export class Scenario {
    private metadata: Record<string, string>;
    private context: (Message | Interaction)[] = []; // 已读消息列表
    private unread: (Message | Interaction)[] = []; // 未读消息列表
    private recallSize: number;
    private lastReplyTime: Date | null = null; // 存储最后回复时间，用于判断消息已读状态
    private platformAdapter: PlatformAdapter;
    private limit: number;

    constructor(private ctx: Context, private session: Session) {
        switch (session.platform) {
            case "onebot":
                this.platformAdapter = new OneBotPlatform(session);
                break;
            default:
                this.platformAdapter = new DefaultPlatform(session);
                break;
        }
    }

    /**
     * 判断群组是否活跃
     */
    public get isActive(): boolean {
        return this.unread.length > 0;
    }

    /**
     * 异步加载初始数据 (仅在 Scenario 首次创建时调用一次)
     * 合并查询消息和交互，减少数据库查询。
     * @param limit 历史消息数量限制
     */
    public async loadInitialData(limit: number = 30) {
        this.limit = limit;
        this.context = [];
        this.unread = [];

        // 1. 获取最后回复时间
        const [lastReplyEntry] = await this.ctx.database.get(LAST_REPLY_TABLE, {
            channelId: this.session.channelId,
        });
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

        const messageIds = chatMessages.map((m) => m.messageId);

        // 获取与这些消息相关的交互
        const chatInteractions = await this.ctx.database
            .select(INTERACTION_TABLE)
            .where((row) => $.in(row.emitter, messageIds))
            .execute();

        // 合并消息和交互并按时间排序
        let history: (Interaction | Message)[] = [...chatMessages, ...chatInteractions];
        history.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        // 计算超出上下文限制的记忆数量
        this.recallSize = Math.max(0, messages.length);

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
        if (isRead) {
            if (this.context.length < this.limit) {
                this.context.push(record);
            } else {
                // 移除最早的消息或交互
                this.context.shift();
                this.context.push(record);
                this.recallSize++;
            }
        } else {
            this.unread.push(record);
        }
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
                };
                break;
            case "private":
                const userInfo = await this.platformAdapter.getUserInfo(this.session.channelId);
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
     * 将场景渲染为字符串，用于 LLM 提示词。
     * 未读消息会被单独列出，并提示 AI 数量。
     */
    public render(): string {
        // 将返回类型限定为 string
        const INDENT_UNIT = "  "; // 2个空格的缩进单位
        const channelType = getChannelType(this.session.channelId);
        // 构建 <new_messages> 块，它需要二级缩进，内部内容需要三级缩进
        const newMessage = this.isActive
            ? [
                  INDENT_UNIT.repeat(2) + "<new_messages>", // <new_messages> 标签在二级缩进
                  ...this.unread.map((msg) => INDENT_UNIT.repeat(3) + this.formatContext(msg)), // 内容在三级缩进
                  INDENT_UNIT.repeat(2) + "</new_messages>", // 闭合标签在二级缩进
              ].join("\n")
            : ""; // 如果没有新消息，则为空字符串
        const outputParts: string[] = [];
        // <scenario> 标签，相对于其父元素（<scenario_update> 或 <no_activity>）应该是一级缩进
        outputParts.push(INDENT_UNIT + `<scenario id="${this.session.channelId}" type="${channelType}">`);
        // 元数据，需要二级缩进
        Object.keys(this.metadata).forEach((k) => {
            outputParts.push(INDENT_UNIT.repeat(2) + `${k.toUpperCase()}: ${this.metadata[k]}`);
        });
        // recall memory 消息，需要二级缩进
        outputParts.push(
            INDENT_UNIT.repeat(2) +
                `${this.recallSize} previous messages between you and the scenario are stored in recall memory (use functions to access them)`
        );
        // 空行（根据示例，recall memory 消息和 chat history 之间没有空行）
        // 如果需要空行，可以在这里添加：outputParts.push("");
        // <recent_chat_history> 标签，需要二级缩进
        outputParts.push(INDENT_UNIT.repeat(2) + `<recent_chat_history>`);
        // chat history 内容，需要三级缩进
        this.context.forEach((msg) => {
            outputParts.push(INDENT_UNIT.repeat(3) + this.formatContext(msg));
        });
        // </recent_chat_history> 标签，需要二级缩进
        outputParts.push(INDENT_UNIT.repeat(2) + `</recent_chat_history>`);
        // 添加新消息块，如果存在的话
        if (newMessage) {
            outputParts.push(newMessage);
        }
        // </scenario> 闭合标签，需要一级缩进
        outputParts.push(INDENT_UNIT + `</scenario>`);
        // 渲染后，将未读消息移至已读消息列表，并清空未读列表
        // 数据库中 last_reply_table 的更新由 LLMProcessingMiddleware 负责
        for (const message of this.unread) {
            this.context.push(message);
        }
        this.unread = [];
        return outputParts.join("\n");
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
                case "quote":
                    content += `[引用 #${elem.attrs.id}]`;
                    break;
                case "forward":
                    content += `[聊天记录 #${elem.attrs.id}]`;
                    break;
                case "text":
                    content += elem.attrs.content;
                    break;
                case "img":
                case "image":
                    content += `[图片 #${elem.attrs.id}]`;
                    break;
                case "at":
                    content += `<at id="${elem.attrs.id}" ${isNotEmpty(elem.attrs.name) ? `name="@${elem.attrs.name}"` : ""}/>`;
                    break;
                default:
                    content += `[${elem.type}]`;
                    break;
            }
        }

        const date = formatDate(message.timestamp);

        const sender = message.sender.id === this.session.bot.selfId ? "YOU" : `${message.sender.name}<${message.sender.id}>`;

        return `[#${message.messageId} ${date} ${sender}] ${content}`;
    }

    private formatInteraction(interaction: Interaction): string {
        if (interaction.type === "tool_result") {
            const name = interaction.content["function"];
            const returnValue = interaction.content["result"];
            return `[FUNCTION RETURN:${name}] ${JSON.stringify(returnValue)}`;
        } else {
            return `[FUNCTION CALL] ${JSON.stringify(interaction.content)}`;
        }
    }
}
