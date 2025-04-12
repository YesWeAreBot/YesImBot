import { Session } from "koishi";
//import { } from "koishi-plugin-adapter-onebot";

import { ChatMessage } from "./models/ChatMessage";


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
    context: string[];

    // 会话实例
    session: Session;

    constructor(session: Session, context: string[] = []) {
        if (!session) throw new Error("Session is required");
        this.session = session;
        this.id = session.channelId;
        this.type = this.getType();
        this.context = context;
    }

    static async create(session: Session, context: string[] = []): Promise<Scenario> {
        const instance = new Scenario(session, context);
        await instance.init();
        return instance;
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

    /**
     * 异步初始化
     */
    private async init() {
        this.name = await this.getName() || "Unnamed";
        this.description = await this.getDescription();
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
        output += `Chat History:\n${this.context.join("\n")}`;
        return output;
    }

    addContext(message: string) {
        this.context.push(message);
    }

    clearContext() {
        this.context = [];
    }
}