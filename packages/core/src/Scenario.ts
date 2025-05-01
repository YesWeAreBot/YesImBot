import { $, Context, Session } from "koishi";
//import { } from "koishi-plugin-adapter-onebot";

import type { Interaction, Message } from "./agent";
import { Agent } from "./agent";
import { ChatMessage } from "./models/ChatMessage";
import { getFormatDateTime } from "./utils";


/**
 * 对话场景
 */
export class Scenario {
    // 场景ID
    id: string;
    // 场景类型
    type: ChatMessage["channelType"];
    // 场景名称
    name: string;
    // 场景描述
    description: string;
    // 场景上下文
    private context: string[] = [];
    // 未读消息列表
    private unread: string[] = [];

    constructor(private ctx: Context, private session: Session) {
        this.id = session.channelId;
        this.type = this.getType();
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
        await this.load();
    }

    async load() {
        // 从数据库加载历史记录
        const chatHistory = await this.ctx.database.get(Agent.MESSAGE_TABLE, {
            channel: { id: this.session.channelId },
        });
        let [lastReplyTime] = await this.ctx.database.get(Agent.LAST_REPLY_TABLE, {
            channelId: this.session.channelId,
        });
        let history: (Interaction | Message)[] = chatHistory;
        for (const chat of chatHistory) {
            const interactions = await this.ctx.database
                .select(Agent.INTERACTION_TABLE)
                .where(row => $.eq(row.emitter, chat.messageId))
                .execute();
            for (const interaction of interactions) {
                history.push(interaction);
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
                if (record["sender"].id == this.session.bot.selfId) {
                    this.addContext(`[${getFormatDateTime(record.timestamp)} YOU] ${record.content}`, isRead);
                    continue;
                }
                this.addContext(`[${getFormatDateTime(record.timestamp)} ${record["sender"].name}<${record["sender"].id}>] ${record.content}`, isRead);
            }
            else {
                // record is interaction
                if (record["type"] === "tool_result") {
                    this.addContext(`[FUNCTION RETURN] ${record["content"]}`, isRead)
                    continue;
                }
                this.addContext(record.content, isRead);
            }
        }

        await this.ctx.database.set(Agent.LAST_REPLY_TABLE, { channelId: this.session.channelId, }, { timestamp: new Date(), });
    }

    private getType() {
        return this.session.guildId ? "guild" : this.session.channelId === "#" ? "sandbox" : "private";
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
    render(includeMetadata = true): string {
        let output = '';
        if (includeMetadata) {
            output += `Scenario ID: ${this.id}
Type: ${this.type}
Name: ${this.name}
Description: ${this.description}\n\n`;
        }
        output += `Chat History:\n${this.context.join("\n")}\n`;
        output += `You have ${this.unread.length} new messages to read:\n${this.unread.join("\n")}`;

        // 清空未读消息
        for (const message of this.unread) {
            this.context.push(message);
        }
        this.unread = [];
        return output;
    }
}
