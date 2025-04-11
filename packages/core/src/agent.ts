import { message } from "@xsai/utils-chat";
import { readFileSync } from "fs";
import { Context, Session, sleep } from "koishi";
import path from "path";

import { AdapterSwitcher } from "./adapters";
import { Config } from "./config";
import { Memory, MemoryBlock } from "./Memory";
import { ChatMessage, createMessage, getChannelType } from "./models/ChatMessage";
import { Scenario } from "./Scenario";
import { getFormatDateTime, isChannelAllowed } from "./utils/toolkit";

declare module "koishi" {
    interface Tables {
        ["yesimbot.agent.message"]: ChatMessage;
    }
}

export class Agent {
    ctx: Context;
    config: Config;
    adapterSwitcher: AdapterSwitcher;
    memory: Memory;
    private _PROMPT: string;
    constructor(ctx: Context, config: Config) {
        this.ctx = ctx;
        this.config = config;
        this.memory = new Memory();
        this.adapterSwitcher = new AdapterSwitcher(config.API.APIList, config.Parameters);

        this._PROMPT = readFileSync(path.join(__dirname, "../resources/memgpt_chat.txt"), "utf-8");

        const humanMemory = new MemoryBlock("human", "human", []);
        const personaMemory = new MemoryBlock("persona", "persona", []);

        readFileSync(path.join(__dirname, "../resources/persona.txt"), "utf-8").split("\n").forEach((line) => {
            personaMemory.append("persona", line);
        });

        this.memory.coreMemory.push(personaMemory, humanMemory);
    }

    async register() {
        // 注册数据库
        this.ctx.model.extend("yesimbot.agent.message", {
            sender: "object",
            messageId: "string",
            channelId: "string",
            channelType: "string",
            sendTime: "timestamp",
            content: "string",
            raw: {
                type: "string",
                nullable: true,
                initial: null,
            },
        }, {
            primary: "messageId", // 主键名
            autoInc: false,       // 不使用自增主键
        });

        // 注册中间件
        this.ctx.middleware(async (session, next) => {
            const { content, channelId, author } = session;

            // 添加到数据库
            const messages = await this.ctx.database.get("yesimbot.agent.message", {
                messageId: session.messageId,
                channelId: session.channelId,
            });
            if (messages.length == 0) {
                await addMessage(this.ctx, await createMessage(session));
            }

            if (!isChannelAllowed(this.config.MemorySlot.SlotContains, session.channelId)) return next();

            // 忽略机器人自身的消息
            if (author.isBot) return next();

            const { adapter } = this.adapterSwitcher.getAdapter();
            if (!adapter) return next();

            const chatHistory = await this.ctx.database.get("yesimbot.agent.message", {
                channelId
            });
            const scenario = await new Scenario(session, []);
            for (const chat of chatHistory) {
                scenario.context.push(`[${getFormatDateTime(chat.sendTime)} ${chat.sender.name}<${chat.sender.id}>] ${chat.content}`);
            }

            const { text } = await adapter.chat([
                message.system(this._PROMPT),
                message.system(this.memory.render()),
                message.user(scenario.render())
            ], null, this.config.Debug.DebugAsInfo);

            await this.handle(session, scenario, text);
        });

        // 注册命令
        this.ctx.command("agent.context.clear", "清空对话").action(async ({ session }) => {
            await this.ctx.database.remove("yesimbot.agent.message", {
                channelId: session.channelId,
            });
            await session.sendQueued("对话已清空");
        });
    }

    /**
     * 
     * @param session 
     * @param text 
     */
    async handle(
        session: Session,
        scenario: Scenario,
        text: string
    ) {
        const obj = JSON.parse(text);
        const { function: functionName, params } = obj;
        if (functionName === "send_message") {
            const { inner_thoughts, messages, channel_id } = params;
            await this.sendMessage(session, messages, channel_id);

        }
        else if (functionName === "core_memory_append") {
            const { inner_thoughts, label, content, request_heartbeat } = params;
            try {
                const returnValue = await this.memory.appendCoreMemory(label, content);
                if (request_heartbeat) {
                    scenario.addContext(`[FUNCTION CALL] core_memory_append(label="${label}", content="${content}")`);
                    scenario.addContext(`[FUNCTION RETURN] ${returnValue}`)
                    const { adapter } = this.adapterSwitcher.getAdapter();
                    const { text } = await adapter.chat([
                        message.system(this._PROMPT),
                        message.system(this.memory.render()),
                        message.user(scenario.render())
                    ], null, this.config.Debug.DebugAsInfo);
                    await this.handle(session, scenario, text);
                }
            } catch (error) {
                console.log(error);
            }
        }
        else {
            scenario.addContext(`FUNCTION ${functionName} NOT FOUND`);
            const { adapter } = this.adapterSwitcher.getAdapter();
            const { text } = await adapter.chat([
                message.system(this._PROMPT),
                message.system(this.memory.render()),
                message.user(scenario.render())
            ], null, this.config.Debug.DebugAsInfo);
            await this.handle(session, scenario, text);
        }
    }

    /**
     * 发送消息
     * 
     * @param message 
     * @param channelId 
     */
    async sendMessage(session: Session, messages: string[], channelId?: string) {
        let delay = messages.length == 0 ? false: true;
        if (!channelId) {
            for await (const message of messages) {
                let messageIds = await session.sendQueued(message)
                if (delay && this.config.Bot.WordsPerSecond > 0) {
                    await sleep(message.length / this.config.Bot.WordsPerSecond * 1000);
                }
                await addMessage(this.ctx, {
                    sender: {
                        id: session.author.id,
                        name: session.author.name,
                        nick: session.author.nick,
                    },
                    messageId: messageIds[0],
                    channelId: session.channelId,
                    channelType: getChannelType(session.channelId),
                    sendTime: new Date(),
                    content: message,
                });
            }
        }
    }
}


async function addMessage(ctx: Context, chatMessage: ChatMessage) {
    return await ctx.database.create("yesimbot.agent.message", chatMessage);
}
