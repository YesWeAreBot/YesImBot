import { $, Context, h, Session } from "koishi";
import type { ImagePart, TextPart } from "xsai";

import { Interaction, INTERACTION_TABLE, LAST_REPLY_TABLE, Message, MESSAGE_TABLE } from "./types/model";
import { formatDate, getChannelType } from "./utils";


/**
 * 对话场景
 */
export class Scenario {
    // 场景ID
    id: string;
    // 场景类型
    type: Message['channel']['type'];
    // 场景名称
    name: string;
    // 场景描述
    description: string;
    // 场景上下文
    private context: string[] = [];
    // 未读消息列表
    private unread: string[] = [];
    // 超出上下文的记忆
    private recallSize: number;

    constructor(private ctx: Context, private session: Session) {
        this.id = session.channelId;
        this.type = getChannelType(session.channelId);
    }

    static async create(ctx: Context, session: Session): Promise<Scenario> {
        const instance = new Scenario(ctx, session);
        await instance.init();
        return instance;
    }

    /**
     * 异步初始化
     */
    private async init() {
        this.name = await this.getName() || "Unnamed";
        this.description = await this.getDescription();
    }

    /**
     *
     * @param limit
     */
    async refresh(limit: number = 30) {
        this.context = [];
        this.unread = [];

        const recall = await this.ctx.database
            .select(MESSAGE_TABLE)
            .where({ channel: { id: this.session.channelId } })
            .orderBy("timestamp", "desc")
            .execute();

        const chatHistory = recall.slice(0, limit);
        this.recallSize = recall.length - chatHistory.length;

        let [lastReplyTime] = await this.ctx.database.get(LAST_REPLY_TABLE, {
            channelId: this.session.channelId,
        });
        let history: (Interaction | Message)[] = chatHistory;
        for (const chat of chatHistory) {
            const interactions = await this.ctx.database
                .select(INTERACTION_TABLE)
                .where(row => $.eq(row.emitter, chat.messageId))
                .execute();
            for await (const interaction of interactions) {
                let life = interaction.life;
                if (life > 0) {
                    history.push(interaction);
                    await this.ctx.database
                        .set(INTERACTION_TABLE, {
                            id: interaction.id
                        }, {
                            life: $.subtract(life, 1)
                        });
                } else {
                    let result = await this.ctx.database
                        .remove(INTERACTION_TABLE, {
                            id: interaction.id,
                        });
                    // this.ctx.logger.warn(`[Scenario] Interaction ${interaction.id} has expired`);
                }
            }
        }
        history = history.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        for (let record of history) {
            let isRead = true;
            if (lastReplyTime && record.timestamp.getTime() > lastReplyTime.timestamp.getTime()) {
                isRead = false;
            }
            if (record["messageId"]) {
                // record is message
                let elements = h.parse(record.content as string);
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
                        default:
                            content += `[${elem.type}]`;
                            break;
                    }
                }

                if (record["sender"].id == this.session.bot.selfId) {
                    this.addContext(`[#${record["messageId"]} ${formatDate(record.timestamp)} YOU] ${content}`, isRead);
                } else {
                    this.addContext(`[#${record["messageId"]} ${formatDate(record.timestamp)} ${record["sender"].name}<${record["sender"].id}>] ${content}`, isRead);
                }
            } else {
                // record is interaction
                if (record["type"] === "tool_result") {
                    this.addContext(`[FUNCTION RETURN] ${JSON.stringify(record["content"])}`, isRead)
                } else {
                    this.addContext(`[FUNCTION CALL] ${JSON.stringify(record["content"])}`, isRead);
                }
            }
        }

        await this.ctx.database.set(LAST_REPLY_TABLE, { channelId: this.session.channelId, }, { timestamp: new Date() });
    }

    private async getName(): Promise<string> {
        if (this.type === "private") {
            //@ts-ignore
            if (this.session.onebot) {
                try {
                    //@ts-ignore
                    let info = await this.session.onebot.getStrangerInfo(this.session.userId);
                    return info.nickname || String(info.user_id);
                } catch (error) {
                }
            }
            return this.session.username;
        }
        else if (this.type === "guild") {
            //@ts-ignore
            if (this.session.onebot) {
                try {
                    //@ts-ignore
                    let info = await this.session.onebot.getGroupInfo(this.session.guildId);
                    return info.group_name
                } catch (error) {
                }
            }
            const guild = await this.session.bot.getGuild(this.session.guildId);
            return guild.name || "Unknown Group";
        }
        else if (this.type === "sandbox") {
            return "Sandbox";
        }
    }

    /**
     * 获取场景描述
     * 可能需要配合平台API获取
     *
     * 私聊为用户签名，群聊为群介绍
     */
    private async getDescription() {
        try {
            if (this.type === "private") {
                return this.session.author.name || "No description";
            } else if (this.type === "guild") {
                return this.session.event.guild?.name || "No description";
            }
            return "Sandbox environment";
        } catch {
            return "No description available";
        }
    }

    addContext(message: string, isRead = false) {
        if (isRead) {
            this.context.push(message);
        } else {
            this.unread.push(message);
        }
    }

    clearContext() {
        this.context = [];
    }

    /**
     * 将场景渲染为字符串
     *
     * @example
     * Scenario ID: <scenario_id>
     * Scenario Name: <scenario_name>
     * Scenario Description: <scenario_description>
     * Your role in this scenario: <your_role>
     * Chat History:
     * [<time> <sender>] <content>
     * You have <count> new messages to read:
     * [<time> <sender>] <content>
     * ...
     */
    render(): string | (TextPart | ImagePart)[] {
        let output = [
            `Scenario ID: ${this.id}`,
            `Type: ${this.type}`,
            `Name: ${this.name}`,
            `Description: ${this.description}`,
            `${this.recallSize} previous messages between you and the scenario are stored in recall memory (use functions to access them)`,
            "",
            `Chat History:`,
            ...this.context,
            "",
            `You have ${this.unread.length} new messages to read:`,
            ...this.unread,
        ].join("\n");

        // 清空未读消息
        for (const message of this.unread) {
            this.context.push(message);
        }
        this.unread = [];
        return output;
    }
}


interface PlatformAdapter {
    getStrangerInfo?(userId: string): Promise<{ nickname?: string }>;
    getGroupInfo?(groupId: string): Promise<{ group_name?: string }>;
}

interface MessageFormatter<T> {
    format(message: T): Promise<string>;
}

interface MultimodalMessageFormatter<T> {
    format(message: T): Promise<{
        textContent: string;
        imageParts: ImagePart[];
    }>;
}
