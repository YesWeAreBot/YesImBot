import { ToolResult } from "@xsai/tool";
import { message } from "@xsai/utils-chat";
import fs from "fs/promises";
import { Context, h, Random, Session, sleep } from "koishi";
import path from "path";
import { z } from "zod";

import { AdapterSwitcher } from "./adapters";
import { Config } from "./config";
import { defineTool } from "./extensions/base";
import { Memory, MemoryBlock } from "./Memory";
import { ChatMessage, createMessage, getChannelType } from "./models/ChatMessage";
import { Scenario } from "./Scenario";
import { getFormatDateTime, isChannelAllowed } from "./utils/toolkit";


declare module "koishi" {
    interface Tables {
        ["yesimbot.agent.message"]: ChatMessage;
        ["yesimbot.agent.memory_block"]: MemoryBlock;
    }
}

// 未读消息
let unreadMessages = 0;
// 上次回复时间
let lastReplyTime = Date.now();

export class Agent {
    ctx: Context;
    config: Config;
    adapterSwitcher: AdapterSwitcher;
    memory: Memory;
    tools: ToolResult[];
    private _PROMPT: string;
    constructor(ctx: Context, config: Config) {
        this.ctx = ctx;
        this.config = config;
        this.memory = new Memory(ctx);
        this.adapterSwitcher = new AdapterSwitcher(config.API.APIList, config.Parameters);
    }

    async initialize() {
        // 注册数据库
        this.ctx.model.extend("yesimbot.agent.message", {
            sender: "object",
            messageId: "string",
            channelId: "string",
            channelType: "string",
            sendTime: "timestamp",
            content: "string",
        }, {
            primary: "messageId", // 主键名
            autoInc: false,       // 不使用自增主键
        });
        this.ctx.model.extend("yesimbot.agent.memory_block", {
            id: "string",
            label: "string",
            //@ts-ignore
            value: "list",
            limit: "integer",
        }, {
            primary: ["id", "label"],
            autoInc: false,
        })

        // 初始化
        this.ctx.logger.info("Agent initialized.");
        this._PROMPT = await fs.readFile(path.join(__dirname, "../resources/memgpt_chat.txt"), "utf-8");

        this.ctx.logger.info("Loading memory blocks...");
        const humanMemory = await MemoryBlock.getOrCreate(this.ctx, "human");
        const personaMemory = await MemoryBlock.getOrCreate(this.ctx, "persona");

        personaMemory.bindFile(path.join(__dirname, "../resources/persona.txt"));

        this.memory.coreMemory.push(personaMemory, humanMemory);
    }

    async register() {
        await this.initialize();

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

            const loginStatus = await session.bot.getLogin();
            const isBotOnline = loginStatus.status === 1;

            let parsedElements = h.parse(content);
        
            const isAtMentioned = parsedElements.some(element =>
              element.type === 'at' &&
              (element.attrs.id === session.bot.selfId || element.attrs.type === 'all' || (isBotOnline && element.attrs.type === 'here'))
            );
            const shouldReactToAt = Random.bool(this.config.MemorySlot.AtReactPossibility);
            const isTriggerCountReached = unreadMessages >= Random.int(this.config.MemorySlot.MinTriggerCount, this.config.MemorySlot.MaxTriggerCount);
            const coldDown = (Date.now() - lastReplyTime) > this.config.MemorySlot.MinTriggerTime;
            if (!coldDown) {
                this.ctx.logger.info(`[Agent] 冷却中，跳过回复`);
                return next();
            }
            const shouldReply = (isAtMentioned && shouldReactToAt) || isTriggerCountReached || this.config.Debug.TestMode

            if (!shouldReply) {
                unreadMessages++;
                this.ctx.logger.info(`[Agent] 未达到触发条件，跳过回复`);
                return next();
            }
            unreadMessages = 0;

            const { adapter } = this.adapterSwitcher.getAdapter();
            if (!adapter) return next();

            const chatHistory = await this.ctx.database.get("yesimbot.agent.message", {
                channelId
            });
            const scenario = await Scenario.create(session);
            for (const chat of chatHistory) {
                if (chat.sender.id == session.bot.selfId) {
                    scenario.addContext(`[${getFormatDateTime(chat.sendTime)} YOU] ${chat.content}`);
                    continue;
                }
                scenario.context.push(`[${getFormatDateTime(chat.sendTime)} ${chat.sender.name}<${chat.sender.id}>] ${chat.content}`);
            }

            const { text } = await adapter.chat([
                message.system(this._PROMPT),
                message.system(await this.memory.render()),
                message.user(scenario.render())
            ], null, this.config.Debug.DebugAsInfo);

            await this.handle(session, scenario, text);
            lastReplyTime = Date.now();
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
                        message.system(await this.memory.render()),
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
                message.system(await this.memory.render()),
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
        let delay = messages.length == 0 ? false : true;
        if (!channelId) {
            for await (const message of messages) {
                let messageIds = await session.sendQueued(message)
                if (delay && this.config.Bot.WordsPerSecond > 0) {
                    await sleep(message.length / this.config.Bot.WordsPerSecond * 1000);
                }
                await addMessage(this.ctx, {
                    sender: {
                        id: session.bot.selfId,
                        name: session.bot.user.name,
                        nick: session.bot.user.nick,
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


const sendMessage = defineTool({
    name: "send_message",
    description: "Sends a message to the human user.",
    parameters: z.object({
        inner_thoughts: z.string().describe("Deep inner monologue private to you only."),
        messages: z.array(z.string()).describe("Message contents. Each item in the list will be sent individually to mimic human sentence breaking behavior."),
        channel_id: z.string().optional().describe("The channel ID to send the message to. If not provided, the message will be sent to the current channel."),
    }),
    execute: async ({ inner_thoughts, messages, channel_id }, context) => {
        const { session } = context;
        if (channel_id) {
            await session.bot.sendMessage(channel_id, messages.join("\n"));
        } else {
            await session.send(messages.join("\n"));
        }
    }
});
