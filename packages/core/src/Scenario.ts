import { $, Context, Element, h, Session } from "koishi";

import { DefaultPlatform, OneBotPlatform, PlatformAdapter } from "./services/PlatformAdapter";
import { Interaction, INTERACTION_TABLE, LAST_REPLY_TABLE, Message, MESSAGE_TABLE } from "./types/model";
import { formatDate, getChannelType } from "./utils";

/**
 * 对话场景
 */
export class Scenario {
    private metadata: Record<string, string>;
    public chatHistory: (Message | Interaction)[] = []; // 已读消息列表
    public newMessages: (Message | Interaction)[] = []; // 未读消息列表
    private recallSize: number; // 数据库中超出上下文限制，但仍可“召回”的历史记录数量
    private lastReplyTime: Date | null = null; // 存储最后回复时间，用于判断消息已读状态
    private platformAdapter: PlatformAdapter;

    constructor(private ctx: Context, private session: Session, private limit: number = 30) {
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
        } catch (error) {
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
     * 渲染此 Scenario 实例的上下文，供 PromptBuilder 使用。
     * 未读消息会被单独列出，并提示 AI 数量。
     */
    public renderForPrompt(): string {
        const INDENT_UNIT = "  "; // 2 spaces
        const channelType = getChannelType(this.session.channelId);
        const isPrivateChat = channelType === "private"; // 是否为私聊场景，私聊会更简洁。

        const outputParts: string[] = [];
        outputParts.push(INDENT_UNIT + `<scenario id="${this.session.channelId}" type="${channelType}">`);
        Object.keys(this.metadata).forEach((k) => {
            outputParts.push(INDENT_UNIT.repeat(2) + `${k.toUpperCase()}: ${this.metadata[k]}`);
        });

        outputParts.push(
            INDENT_UNIT.repeat(2) +
                `${this.recallSize} previous messages between you and the scenario are stored in recall memory (use functions to access them)`
        );

        if (this.chatHistory.length > 0) {
            outputParts.push(INDENT_UNIT.repeat(2) + `<recent_chat_history>`);
            this.chatHistory.forEach((msg) => {
                outputParts.push(INDENT_UNIT.repeat(3) + this.formatContext(msg));
            });
            outputParts.push(INDENT_UNIT.repeat(2) + `</recent_chat_history>`);
        } else {
            outputParts.push(INDENT_UNIT.repeat(2) + `<recent_chat_history>(No recent chat history available)</recent_chat_history>`);
        }

        if (this.isActive) {
            outputParts.push(INDENT_UNIT.repeat(2) + "<new_messages>");
            this.newMessages.forEach((msg) => {
                outputParts.push(INDENT_UNIT.repeat(3) + this.formatContext(msg));
            });
            outputParts.push(INDENT_UNIT.repeat(2) + "</new_messages>");
        }

        outputParts.push(INDENT_UNIT + `</scenario>`);

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
                    content += `[引用#${elem.attrs.id}]`;
                    break;
                case "text":
                    content += Element.escape(elem.attrs.content) || "";
                    break;
                case "img":
                case "image":
                    content += h("img", elem.attrs).toString();
                    break;
                case "at":
                    content += h("at", elem.attrs);
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
        const SELF_IDENTIFIER = "YOU"; // 用于标识机器人自身的标识符

        let sender = message.sender.id === this.session.bot.selfId ? SELF_IDENTIFIER : `${message.sender.name}<${message.sender.id}>`;
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
