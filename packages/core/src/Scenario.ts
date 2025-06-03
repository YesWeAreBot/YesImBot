import { $, Context, Element, h, Session } from "koishi";

import { DefaultPlatform, OneBotPlatform, PlatformAdapter } from "./services/PlatformAdapter";
import { Interaction, INTERACTION_TABLE, LAST_REPLY_TABLE, Message, MESSAGE_TABLE } from "./types/model";
import { formatDate, getChannelType, isNotEmpty } from "./utils";

/**
 * 对话场景
 */
export class Scenario {
    private metadata: Record<string, string>;
    public context: (Message | Interaction)[] = []; // 已读消息列表
    public unread: (Message | Interaction)[] = []; // 未读消息列表
    private recallSize: number; // 数据库中超出上下文限制，但仍可“召回”的历史记录数量
    private lastReplyTime: Date | null = null; // 存储最后回复时间，用于判断消息已读状态
    private platformAdapter: PlatformAdapter;
    private limit: number; // 上下文消息数量限制

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
     * 判断群组是否活跃（有未读消息）
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
        const [lastReplyEntry] = await this.ctx.database.get(LAST_REPLY_TABLE, { channelId: this.session.channelId });
        this.lastReplyTime = lastReplyEntry ? lastReplyEntry.timestamp : null;

        // 2. 批量查询消息和交互
        const messages = await this.ctx.database
            .select(MESSAGE_TABLE)
            .where({ channel: { id: this.session.channelId } })
            .orderBy("timestamp", "desc")
            .execute();

        const chatMessagesToLoad = messages.filter((m) => m.messageId !== this.session.messageId).slice(0, limit);

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
            // 根据 lastReplyTime 判断是否为已读
            const isRead = this.lastReplyTime ? record.timestamp.getTime() <= this.lastReplyTime.getTime() : false;
            this.addContext(record, isRead, true);
        }

        // 初始化场景名称和描述
        try {
            this.metadata = await this.getMetaData();
        } catch (error) {
            this.ctx.logger.warn(`Failed to get scenario metadata for ${this.session.channelId}: ${error.message}`);
            this.metadata = {};
        }
    }

    /**
     * 添加消息或交互到 Scenario 的上下文。
     * @param record 消息或交互对象
     * @param isRead 是否为已读（机器人视角）
     * @param isLoadingInitialData 标记是否在初始加载数据，避免在加载时错误增加 recallSize
     */
    public addContext(record: Message | Interaction, isRead = false, isLoadingInitialData = false) {
        const targetArray = isRead ? this.context : this.unread;

        if (isRead) {
            if (this.context.length >= this.limit) {
                const shiftedItem = this.context.shift(); // 移除最早的消息或交互
                // Only increment recallSize if a MESSAGE was shifted out during non-initial load
                // And if we are not in the initial loading phase (recallSize is set once there)
                if (!isLoadingInitialData && shiftedItem && (shiftedItem as Message).messageId) {
                    // This logic for recallSize might be tricky if interactions are also shifted.
                    // recallSize is primarily for messages.
                }
                this.recallSize++;
            }
            this.context.push(record);
        } else {
            this.unread.push(record);
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

        this.context = processArray(this.context);
        this.unread = processArray(this.unread);

        if (prunedCount > 0) {
            this.ctx.logger.debug(
                `[Scenario ${this.session.channelId}] Pruned ${prunedCount} expired interactions from in-memory context.`
            );
        }
    }

    public clearContext() {
        this.context = [];
        this.unread = [];
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
     * 将场景渲染为字符串，用于 LLM 提示词。
     * 未读消息会被单独列出，并提示 AI 数量。
     */
    public render(): string {
        const INDENT_UNIT = "  ";
        const channelType = getChannelType(this.session.channelId);

        const outputParts: string[] = [];
        outputParts.push(INDENT_UNIT + `<scenario id="${this.session.channelId}" type="${channelType}">`);
        Object.keys(this.metadata).forEach((k) => {
            outputParts.push(INDENT_UNIT.repeat(2) + `${k.toUpperCase()}: ${this.metadata[k]}`);
        });

        outputParts.push(
            INDENT_UNIT.repeat(2) +
                `${this.recallSize} previous messages between you and the scenario are stored in recall memory (use functions to access them)`
        );

        if (this.context.length > 0) {
            outputParts.push(INDENT_UNIT.repeat(2) + `<recent_chat_history>`);
            this.context.forEach((msg) => {
                outputParts.push(INDENT_UNIT.repeat(3) + this.formatContext(msg));
            });
            outputParts.push(INDENT_UNIT.repeat(2) + `</recent_chat_history>`);
        } else {
            outputParts.push(INDENT_UNIT.repeat(2) + `<recent_chat_history>(No recent chat history available)</recent_chat_history>`);
        }

        if (this.isActive) {
            outputParts.push(INDENT_UNIT.repeat(2) + "<new_messages>");
            this.unread.forEach((msg) => {
                outputParts.push(INDENT_UNIT.repeat(3) + this.formatContext(msg));
            });
            outputParts.push(INDENT_UNIT.repeat(2) + "</new_messages>");
        }

        outputParts.push(INDENT_UNIT + `</scenario>`);

        for (const message of [...this.unread]) {
            this.addContext(message, true);
        }
        this.unread = [];

        while (this.context.length > this.limit) {
            this.context.shift();
        }

        return outputParts.join("\n");
    }

    private formatContext(record: Message | Interaction): string {
        if ((record as Interaction).functionName !== undefined) {
            return this.formatInteraction(record as Interaction);
        } else {
            return this.formatMessage(record as Message);
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
                case "text":
                    content += Element.escape(elem.attrs.content) || "";
                    break;
                case "img":
                case "image":
                    content += h("img", elem.attrs).toString();
                    break;
                case "at":
                    content += `<at id="${elem.attrs.id}"${isNotEmpty(elem.attrs.name) ? ` name="@${elem.attrs.name}"` : ""}/>`;
                    break;
                case "face":
                    content += `[表情:${elem.attrs.id}]`;
                    break;
                case "video":
                case "audio":
                case "file":
                    content += `[${elem.type}]`;
                    break;
                default:
                    content += `[${elem.type}]`;
                    break;
            }
        }

        const date = formatDate(message.timestamp);
        let sender = message.sender.id === this.session.bot.selfId ? "YOU" : `${message.sender.name}<${message.sender.id}>`;
        if (message.sender.id !== this.session.bot.selfId && !message.sender.name && message.sender.nick) {
            if (message.sender.nick && message.sender.nick !== message.sender.name) {
                sender = `${message.sender.nick}(${message.sender.name})<${message.sender.id}>`;
            }
        }
        return `[#${message.messageId} ${date} ${sender}] ${content}`;
    }

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
}
