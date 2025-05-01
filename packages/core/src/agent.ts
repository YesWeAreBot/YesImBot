import { message } from "xsai";
import fs from "fs/promises";
import { Context, h, Random, Session, sleep } from "koishi";
import path from "path";
import { z } from "zod";

import { AdapterSwitcher } from "./adapters";
import { Config } from "./config";
import { Tool, ToolManager } from "./extensions/base";
import { Memory, MemoryBlock } from "./Memory";
import { getChannelType } from "./models/ChatMessage";
import { Scenario } from "./Scenario";
import { extractJSONFromString } from "./utils/parse-structured-output";
import { isChannelAllowed } from "./utils/toolkit";


declare module "koishi" {
    interface Tables {
        [Agent.MESSAGE_TABLE]: {
            messageId: string;
            sender: {
                id: string;
                name: string;
                nick: string;
            }
            channel: {
                id: string;
                type: "private" | "guild" | "sandbox";
            }
            sendTime: Date;
            content: string;
            raw?: string;
        };
        [Agent.MEMORY_TABLE]: MemoryBlock;
        [Agent.INTERACTION_TABLE]: {
            id: string;
            channelId: string;
            type: "tool_call" | "tool_response" | "message" | "llm_response";
            content: string;
            timestamp: Date;
        };
    }
}


export class Agent {
    static readonly MESSAGE_TABLE = "yesimbot.agent.message";
    static readonly MEMORY_TABLE = "yesimbot.agent.memory_block";
    static readonly INTERACTION_TABLE = "yesimbot.agent.interaction";

    private ctx: Context;
    private config: Config;
    private adapterSwitcher: AdapterSwitcher;
    private memory: Memory;
    private toolManager: ToolManager;

    // 未读消息
    private unreadMessages = 0;
    // 上次回复时间
    private lastReplyTime = Date.now();

    private _PROMPT: string;
    constructor(ctx: Context, config: Config) {
        this.ctx = ctx;
        this.config = config;
        this.memory = new Memory(ctx);
        this.adapterSwitcher = new AdapterSwitcher(config.API.APIList, config.Parameters);
        this.toolManager = ToolManager.getInstance();

        // 注册核心工具
        this.toolManager.registerTool(createSendMessageTool(config));
    }

    async initialize() {
        // 注册数据库
        this.ctx.model.extend(Agent.MESSAGE_TABLE, {
            messageId: "string",
            sender: "object",
            channel: "object",
            sendTime: "timestamp",
            content: "string",
        }, {
            primary: "messageId", // 主键名
            autoInc: false,       // 不使用自增主键
        });

        this.ctx.model.extend(Agent.MEMORY_TABLE, {
            id: "string",
            label: "string",
            value: "array",
            limit: "integer",
        }, {
            primary: ["id", "label"],
            autoInc: false,
        })

        // 交互记录表
        this.ctx.model.extend(Agent.INTERACTION_TABLE, {
            id: "string",
            channelId: "string",
            type: "string",
            content: "string",
            timestamp: "timestamp"
        }, {
            primary: "id"
        })

        // 初始化
        try {
            this._PROMPT = await fs.readFile(path.join(__dirname, "../resources/memgpt_chat.txt"), "utf-8");
            // 加载工具
            this.ctx.logger.info("[Tool] Loading tools");
            this.toolManager.loadExtensions(this.ctx.logger);

            this._PROMPT += [
                `Available functions:`,
                this.toolManager.getToolPrompts()
            ].join("\n");

            // 加载记忆块
            this.ctx.logger.info("[Memory] Loading memory_blocks");
            const humanMemory = await MemoryBlock.getOrCreate(this.ctx, "human");
            const personaMemory = await MemoryBlock.getOrCreate(this.ctx, "persona");
            personaMemory.bindFile(path.join(__dirname, "../resources/persona.txt"));
            this.memory.coreMemory.push(personaMemory, humanMemory);
        } catch (error) {
            this.ctx.logger.error('Failed to load prompt or memory:', error);
            throw error;
        }
    }

    async register() {
        await this.initialize();

        // 注册中间件
        this.ctx.middleware(async (session, next) => {
            const { content, channelId, author } = session;
            // 添加到数据库
            const messages = await this.ctx.database.get(Agent.MESSAGE_TABLE, {
                messageId: session.messageId,
                channel: {
                    id: channelId
                }
            });
            if (messages.length == 0) {
                await this.ctx.database.create(Agent.MESSAGE_TABLE, {
                    messageId: session.messageId,
                    sender: session.author,
                    channel: {
                        id: channelId,
                        type: getChannelType(channelId),
                    },
                    sendTime: new Date(),
                    content: session.content,
                });
                this.unreadMessages++;
                this.ctx.logger.info(`Received message: ${session.content}`);
            }

            // 检查是否在允许的频道
            if (!isChannelAllowed(this.config.MemorySlot.SlotContains, session.channelId)) return next();

            // 忽略机器人自身的消息
            if (author.isBot) return next();
            const loginStatus = await session.bot.getLogin();
            const isBotOnline = loginStatus.status === 1;
            const isTargetAt = h.parse(content).some(element =>
                element.type === 'at' &&
                (element.attrs.id === session.bot.selfId || element.attrs.type === 'all' || (isBotOnline && element.attrs.type === 'here'))
            );
            const shouldReactToAt = Random.bool(this.config.MemorySlot.AtReactPossibility);
            const isTriggerCountReached = this.unreadMessages >= Random.int(this.config.MemorySlot.MinTriggerCount, this.config.MemorySlot.MaxTriggerCount);
            const coldDown = (Date.now() - this.lastReplyTime) > this.config.MemorySlot.MinTriggerTime;
            if (!coldDown) {
                this.ctx.logger.info(`[Agent] 冷却中，跳过回复`);
                return next();
            }
            const shouldReply = (isTargetAt && shouldReactToAt) || isTriggerCountReached || this.config.Debug.TestMode

            if (!shouldReply) {
                this.ctx.logger.info(`[Agent] 未达到触发条件，跳过回复`);
                return next();
            }
            this.unreadMessages = 0;

            const { adapter } = this.adapterSwitcher.getAdapter();
            if (!adapter) return next();

            const scenario = await Scenario.create(this.ctx, session);

            const { text } = await adapter.chat([
                message.system(this._PROMPT),
                message.system(await this.memory.render()),
                message.user(scenario.render())
            ], null, this.config.Debug.DebugAsInfo);

            await this.handle(session, scenario, text);
            this.lastReplyTime = Date.now();
        });

        // 注册命令
        this.ctx.command("agent.context.clear", "清空对话").action(async ({ session }) => {
            await this.ctx.database.remove(Agent.MESSAGE_TABLE, {
                channel: {
                    id: session.channelId
                }
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
        let response;
        try {
            [response] = extractJSONFromString(text, "object") as any[];
        } catch (error) {
            try {
                [response] = extractJSONFromString(text, "array") as any[];
            } catch (error) {
                this.ctx.logger.error(`[Agent] 解析响应失败: ${error}`);
                return;
            }
        }

        // 记录LLM响应
        await this.ctx.database.create(Agent.INTERACTION_TABLE, {
            id: Random.id(),
            channelId: session.channelId,
            type: "llm_response",
            content: text,
            timestamp: new Date()
        });

        let request_heartbeat = false;
        if (!Array.isArray(response)) {
            response = [response];
        }
        for (const { function: functionName, params } of response) {
            const result = await this.executeToolCall(functionName, params, session);

            // 记录工具调用
            await this.ctx.database.create("yesimbot.agent.interaction", {
                id: Random.id(),
                channelId: session.channelId,
                type: "tool_call",
                content: `${functionName}(${JSON.stringify(params)}) => ${result.success ? result.result : `ERROR: ${result.error}`
                    }`,
                timestamp: new Date()
            });

            if (result.success) {
                scenario.addContext(`[FUNCTION CALL] ${functionName}(${JSON.stringify(params)})`);
                scenario.addContext(`[FUNCTION RETURN] ${result.result}`);
            } else {
                scenario.addContext(`[ERROR] ${result.error}`);
            }
            if (params.request_heartbeat) {
                request_heartbeat = true;
            }
        }

        // 如果需要继续对话
        if (request_heartbeat) {
            const { adapter } = this.adapterSwitcher.getAdapter();
            const { text } = await adapter.chat([
                message.system(this._PROMPT),
                message.system(await this.memory.render()),
                message.user(scenario.render())
            ], null, this.config.Debug.DebugAsInfo);

            await this.handle(session, scenario, text);
        }

    }

    async executeToolCall(
        functionName: string,
        params: any,
        session: Session
    ): Promise<ToolCallResult> {
        try {
            const tool = this.toolManager.getTool(functionName);
            if (!tool) {
                return {
                    success: false,
                    error: `Tool ${functionName} not found`
                };
            }
            const context = { session, ctx: this.ctx };
            const result = await tool.execute(params, context);
            return {
                success: true,
                result
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

interface ToolCallResult {
    success: boolean;
    result?: any;
    error?: string;
}

function createSendMessageTool(config: Config) {
    return Tool({
        name: "send_message",
        description: "Sends a message to the human user.",
        parameters: z.object({
            inner_thoughts: z.string().describe("Deep inner monologue private to you only."),
            messages: z.array(z.string()).describe("Message contents. Each item in the list will be sent individually to mimic human sentence breaking behavior."),
            channel_id: z.string().optional().describe("The channel ID to send the message to. If not provided, the message will be sent to the current channel."),
        }),
        execute: async ({ inner_thoughts, messages, channel_id }, context) => {
            const { ctx, session } = context;

            let idx = 1;
            let delay = true;
            if (!channel_id) {
                channel_id = context.session.channelId;
            }

            for await (const message of messages) {
                // 如果是最后一条消息，不延迟
                if (idx++ >= messages.length) {
                    delay = false;
                } 
                let messageIds = await session.sendQueued(message);
                await ctx.database.create(Agent.MESSAGE_TABLE, {
                    messageId: messageIds[0],
                    sender: {
                        id: session.bot.selfId,
                        name: session.bot.user.name,
                        nick: session.bot.user.nick,
                    },
                    channel: {
                        id: channel_id,
                        type: getChannelType(channel_id),
                    },
                    sendTime: new Date(),
                    content: message,
                });
                ctx.logger.info(`Received message: ${message}`);
                if (delay && config.Bot.WordsPerSecond > 0) {
                    await sleep(message.length / config.Bot.WordsPerSecond * 1000);
                }
            }
        }
    });
}


