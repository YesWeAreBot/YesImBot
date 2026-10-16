import { Context, h, Schema } from "koishi";
import { CQCode } from "koishi-plugin-adapter-onebot";

import { Extension, Tool, withInnerThoughts } from "../../extension/decorators";
import { Failed, Success } from "../../extension/helpers";
import { Infer } from "../../extension/types";
import { assertReplyTurn, formatDate, isEmpty } from "../../shared";

interface InteractionsConfig {}

const InteractionsConfigSchema: Schema<InteractionsConfig> = Schema.object({});

@Extension({
    name: "interactions",
    display: "群内交互",
    version: "1.1.0",
    description: "允许大模型在群内进行交互",
    author: "HydroGest",
    builtin: true,
})
export default class InteractionsExtension {
    static readonly Config = InteractionsConfigSchema;
    static readonly inject = ["yesimbot"];

    constructor(
        public ctx: Context,
        public config: InteractionsConfig,
    ) {}

    @Tool({
        name: "reaction_create",
        description: `在当前频道对一个或多个消息进行表态。表态编号是数字，这里是一个简略的参考：惊讶(0)，不适(1)，无语(27)，震惊(110)，滑稽(178), 点赞(76)`,
        parameters: withInnerThoughts({
            message_id: Schema.string().required().description("消息 ID"),
            emoji_id: Schema.number().required().description("表态编号"),
        }),
        isSupported: (session) => session.platform === "onebot",
    })
    async reactionCreate({ session, message_id, emoji_id }: Infer<{ message_id: string; emoji_id: number }>) {
        if (!session) return Failed("session 不可用");
        if (isEmpty(message_id) || isEmpty(String(emoji_id))) return Failed("message_id and emoji_id is required");
        try {
            const result = await session.onebot!._request!("set_msg_emoji_like", {
                message_id: message_id,
                emoji_id: emoji_id,
            });

            if ((result as any)["status"] === "failed") return Failed((result as any)["message"]);
            this.ctx.logger.info(`Bot[${session.selfId}]对消息 ${message_id} 进行了表态： ${emoji_id}`);
            return Success(result);
        } catch (error) {
            this.ctx.logger.error(`Bot[${session.selfId}]执行表态失败: ${message_id}, ${emoji_id} - `, error.message);
            return Failed(`对消息 ${message_id} 进行表态失败： ${error.message}`);
        }
    }

    @Tool({
        name: "essence_create",
        description: `在当前频道将一个消息设置为精华消息。常在你认为某个消息十分重要或过于典型时使用。`,
        parameters: withInnerThoughts({
            message_id: Schema.string().required().description("消息 ID"),
        }),
        isSupported: (session) => session.platform === "onebot",
    })
    async essenceCreate({ session, message_id }: Infer<{ message_id: string }>) {
        if (!session) return Failed("session 不可用");
        if (isEmpty(message_id)) return Failed("message_id is required");
        try {
            await session.onebot!.setEssenceMsg(message_id);
            this.ctx.logger.info(`Bot[${session.selfId}]将消息 ${message_id} 设置为精华`);
            return Success();
        } catch (error) {
            this.ctx.logger.error(`Bot[${session.selfId}]设置精华消息失败: ${message_id} - `, error.message);
            return Failed(`设置精华消息失败： ${error.message}`);
        }
    }

    @Tool({
        name: "essence_delete",
        description: `在当前频道将一个消息从精华中移除。`,
        parameters: withInnerThoughts({
            message_id: Schema.string().required().description("消息 ID"),
        }),
        isSupported: (session) => session.platform === "onebot",
    })
    async essenceDelete({ session, message_id }: Infer<{ message_id: string }>) {
        if (!session) return Failed("session 不可用");
        if (isEmpty(message_id)) return Failed("message_id is required");
        try {
            const result = await session.onebot!.deleteEssenceMsg(message_id);
            this.ctx.logger.info(`Bot[${session.selfId}]将消息 ${message_id} 从精华中移除`);
            return Success();
        } catch (error) {
            this.ctx.logger.error(`Bot[${session.selfId}]从精华中移除消息失败: ${message_id} - `, error.message);
            return Failed(`从精华中移除消息失败： ${error.message}`);
        }
    }

    @Tool({
        name: "send_poke",
        description: `发送戳一戳、拍一拍消息，常用于指定你交流的对象，或提醒某位用户注意。`,
        parameters: withInnerThoughts({
            user_id: Schema.string().required().description("用户名称"),
            channel: Schema.string().description("要在哪个频道运行，不填默认为当前频道"),
        }),
        isSupported: (session) => session.platform === "onebot",
    })
    async sendPoke({ session, user_id, channel }: Infer<{ user_id: string; channel: string }>) {
        if (!session) return Failed("session 不可用");
        if (isEmpty(String(user_id))) return Failed("user_id is required");
        const targetChannel = isEmpty(channel) ? session.channelId : channel;
        try {
            const result = await session.onebot!._request!("group_poke", {
                group_id: targetChannel,
                user_id: Number(user_id),
            });

            if ((result as any)["status"] === "failed") return Failed((result as any)["data"]);

            this.ctx.logger.info(`Bot[${session.selfId}]戳了戳 ${user_id}`);
            return Success(result);
        } catch (error) {
            this.ctx.logger.error(`Bot[${session.selfId}]戳了戳 ${user_id}，但是失败了 - `, error.message);
            return Failed(`戳了戳 ${user_id} 失败： ${error.message}`);
        }
    }

    @Tool({
        name: "get_forward_msg",
        description: `获取合并转发消息的内容，按根转发第0层、子转发第1层、普通内容第2层展开；第2层的转发不再展开。同层并列内容不设数量上限。无法展开的子转发保留标记及原因，平台未返回的内容无法恢复。`,
        parameters: withInnerThoughts({
            id: Schema.string().required().description("合并转发 ID，如在 `<forward id='12345'>` 中的 12345 即是其 ID"),
        }),
        isSupported: (session) => session.platform === "onebot",
    })
    async getForwardMsg({ session, id }: Infer<{ id: string }>) {
        if (!session) return Failed("session 不可用");
        if (isEmpty(id)) return Failed("id is required");
        try {
            const cache = new Map<string, Promise<unknown>>();
            const load = (forwardId: string): Promise<unknown> => {
                assertReplyTurn();
                let request = cache.get(forwardId);
                if (!request) {
                    request = Promise.resolve().then(() => session.onebot!.getForwardMsg(forwardId));
                    cache.set(forwardId, request);
                }
                return request;
            };
            const forwardMessages = await load(id);
            const formattedResult = await formatForwardMessage(this.ctx, forwardMessages, load, new Set([id]));

            return Success(formattedResult);
        } catch (error) {
            assertReplyTurn();
            const message = error instanceof Error ? error.message : String(error);
            this.ctx.logger.error(`Bot[${session.selfId}]获取转发消息失败: ${id} - `, message);
            return Failed(`获取转发消息失败： ${message}`);
        }
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function forwardId(value: unknown, field: string): string {
    if ((typeof value === "string" && value.trim()) || (typeof value === "number" && Number.isFinite(value))) return String(value);
    throw new Error(`转发消息的 ${field} 缺失或无效`);
}

function forwardTime(value: unknown): string {
    if (value === undefined) return "未知时间";
    if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) throw new Error("转发消息的 time 无效");
    const seconds = Number(value),
        date = new Date(seconds * 1000);
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(date.getTime())) throw new Error("转发消息的 time 无效");
    return formatDate(date, "YYYY-MM-DD HH:mm:ss");
}

// The outer forward is level 0; ordinary messages may occupy level 2.
const MAX_FORWARD_LEVEL = 2;

async function formatForwardMessage(ctx: Context, messages: unknown, load: (id: string) => Promise<unknown>, ancestors: Set<string>): Promise<string> {
    const chunks: string[] = [];
    const append = (text: string) => chunks.push(text);
    const render = async (list: unknown, level: number, path: Set<string>): Promise<void> => {
        if (!Array.isArray(list)) throw new Error("转发消息列表缺失或无效");
        if (!list.length) {
            append("无有效消息内容");
            return;
        }
        // Depth is local to each branch; siblings never consume each other's capacity.
        for (const [index, input] of list.entries()) {
            assertReplyTurn();
            if (!isRecord(input)) throw new Error(`转发消息第 ${index + 1} 个节点无效`);
            const message = input.type === "node" ? input.data : input;
            if (!isRecord(message)) throw new Error(`转发消息第 ${index + 1} 个节点数据无效`);
            const sender = isRecord(message.sender) ? message.sender : { nickname: message.nickname ?? message.name, user_id: message.user_id ?? message.uin };
            const userId = forwardId(sender.user_id, "sender.user_id/uin");
            const name = typeof sender.nickname === "string" && sender.nickname ? sender.nickname : userId;
            const timestamp = forwardTime(message.time);
            const emptyContent = message.content === "" || (Array.isArray(message.content) && !message.content.length);
            const content = emptyContent && message.message !== undefined ? message.message : (message.content ?? message.message);
            if (typeof content !== "string" && !Array.isArray(content)) throw new Error(`转发消息第 ${index + 1} 个节点缺少合法的 content/message`);
            append(`${index ? "\n" : ""}[${timestamp}|${name}(${userId})]: `);
            const groups = typeof content === "string" ? [content] : content;
            if (!content.length) append("（空消息）");
            for (const segment of groups) {
                assertReplyTurn();
                if (typeof segment !== "string" && (!isRecord(segment) || typeof segment.type !== "string" || !segment.type || !isRecord(segment.data)))
                    throw new Error(`转发消息第 ${index + 1} 个节点的消息段无效`);
                const parsed = CQCode.parse((typeof segment === "string" ? segment : [segment]) as Parameters<typeof CQCode.parse>[0]);
                for (const element of parsed) {
                    assertReplyTurn();
                    switch (element.type) {
                        case "text":
                            if (typeof element.attrs.content !== "string") throw new Error("转发文本消息段缺少 text");
                            append(element.attrs.content);
                            break;
                        case "image": {
                            const src = element.attrs.url || element.attrs.file;
                            if (typeof src !== "string" || !src.trim()) throw new Error("转发消息的 image.url/file 缺失或无效");
                            append(await ctx.yesimbot.asset.transform([h("img", { src })]));
                            break;
                        }
                        case "at": {
                            const id = forwardId(element.attrs.qq, "at.qq");
                            append(id === "all" ? h("at", { type: "all" }).toString() : h.at(id).toString());
                            break;
                        }
                        case "reply":
                            append(h("quote", { id: forwardId(element.attrs.id, "reply.id") }).toString());
                            break;
                        case "forward": {
                            const id = forwardId(element.attrs.id, "forward.id");
                            const marker = h("forward", { id }).toString();
                            if (path.has(id)) {
                                append(`${marker}（循环引用，未继续展开）`);
                                break;
                            }
                            if (level + 1 >= MAX_FORWARD_LEVEL) {
                                append(`${marker}（已达三层展开上限：第0层根转发、第1层子转发、第2层普通内容）`);
                                break;
                            }
                            let opened = false;
                            try {
                                const nested = await load(id);
                                if (nested === undefined || nested === null) {
                                    append(`${marker}（平台未提供子转发内容）`);
                                    break;
                                }
                                append(
                                    `${h("forward", { id, depth: level + 1 })
                                        .toString()
                                        .replace(/\/>$/, ">")}\n`,
                                );
                                opened = true;
                                await render(nested, level + 1, new Set(path).add(id));
                            } catch {
                                assertReplyTurn();
                                append(`${marker}（子转发获取失败或数据无效）`);
                            } finally {
                                if (opened) append("\n</forward>");
                            }
                            break;
                        }
                        case "node": {
                            if (level + 1 >= MAX_FORWARD_LEVEL) {
                                append("<forward/>（已达三层展开上限：第0层根转发、第1层子转发、第2层普通内容）");
                                break;
                            }
                            append(`<forward depth="${level + 1}">\n`);
                            try {
                                await render([{ type: "node", data: element.attrs }], level + 1, path);
                            } catch {
                                assertReplyTurn();
                                append("（内嵌转发数据无效）");
                            } finally {
                                append("\n</forward>");
                            }
                            break;
                        }
                        default:
                            append(h(element.type, element.attrs).toString());
                    }
                }
            }
        }
    };
    await render(messages, 0, ancestors);
    return chunks.join("");
}
