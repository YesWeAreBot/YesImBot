import { Session } from "koishi";
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
        this.id = session.channelId || "unknown";
        this.type = this.getType();
        this.initNameAndDescription();
        this.context = context;
    }

    private getType() {
        return this.session.guildId ? "guild" : this.session.channelId === "#" ? "sandbox" : "private";
    }

    private async getName() {
        
        if (this.type === "private") {
            return this.session.username;
        }
        else if (this.type === "guild") {
            const guild = await this.session.bot.getGuild(this.session.guildId);
            return this.session.event.guild.name || "Unknown Group";
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
    private getDescription() {
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
    private async initNameAndDescription() {
        this.name = await this.getName() || "Unnamed";
        this.description = this.getDescription();
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
    render(includeMetadata = true) {
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

        // 添加上下文操作方法
        addContext(message: string) {
            this.context.push(message);
        }
    
        clearContext() {
            this.context = [];
        }
}