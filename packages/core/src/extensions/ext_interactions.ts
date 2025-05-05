// ==Extension==
// @name         Interactions
// @version      1.0.0
// @description  允许大模型在聊群内进行交互
// @author       HydroGest
// ==/Extension==

import { z } from "zod";

import { isEmpty } from "../utils/string";
import { Failed, INNER_THOUGHTS, REQUEST_HEARTBEAT, Success, Tool } from "./base";


export const Reaction = Tool({
    name: "reaction-create",
    description: `在当前频道对一个或多个消息进行表态。表态编号是数字，这里是一个简略的参考：惊讶(0)，不适(1)，无语(27)，震惊(110)，滑稽(178), 点赞(76)`,
    parameters: z.object({
        INNER_THOUGHTS,
        message: z.string().describe("消息 ID"),
        emoji_id: z.number().describe("表态编号"),
        REQUEST_HEARTBEAT,
    }),
    execute: async ({ message, emoji_id }, context) => {
        try {
            // @ts-ignore
            await this.session.onebot._request("set_msg_emoji_like", { message_id: message, emoji_id: emoji_id });
            context.ctx.logger.info(`Bot[${context.session.selfId}]对消息 ${message} 进行了表态： ${emoji_id}`);
            return Success();
        } catch (e) {
            context.ctx.logger.error(`Bot[${context.session.selfId}]执行表态失败: ${message}, ${emoji_id} - `, e.message);
            return Failed(`对消息 ${message} 进行表态失败： ${e.message}`)
        }
    }
})

export const Essence = Tool({
    name: "essence-create",
    description: `在当前频道将一个消息设置为精华消息。常在你认为某个消息十分重要或过于典型时使用。`,
    parameters: z.object({
        INNER_THOUGHTS,
        message: z.number().describe("消息 ID"),
        REQUEST_HEARTBEAT,
    }),
    execute: async ({ message }, context) => {
        try {
            // @ts-ignore
            await this.session.onebot._request("set_essence_msg", { message_id: message })
            context.ctx.logger.info(`Bot[${context.session.selfId}]将消息 ${message} 设置为精华`);
            return Success();
        } catch (e) {
            context.ctx.logger.error(`Bot[${context.session.selfId}]设置精华消息失败: ${message} - `, e.message);
            return Failed(`设置精华消息失败： ${e.message}`)
        }
    }
})

export const Poke = Tool({
    name: "send-poke",
    description: `发送戳一戳、拍一拍消息，常用于指定你交流的对象，或提醒某位用户注意。`,
    parameters: z.object({
        INNER_THOUGHTS,
        user_id: z.string().describe("用户名称"),
        channel: z.string().optional().describe("要在哪个频道运行，不填默认为当前频道"),
        REQUEST_HEARTBEAT,
    }),
    execute: async ({ user_id, channel }, context) => {
        try {
            let channelId: string;
            if (isEmpty(channel)) {
                channelId = context.session.channelId;
            } else {
                channelId = channel;
            }
            if (!channelId.startsWith("private:")) {
                // @ts-ignore
                await this.session.onebot._request("send_poke", { channel: channelId, channelId: channelId, group_id: channelId, user_id: user_id }); // group_id✔
            } else {
                // @ts-ignore
                await this.session.onebot._request("send_poke", { user_id: user_id });
            }
            context.ctx.logger.info(`Bot[${context.session.selfId}]戳了戳 ${user_id}`);
            return Success();
        } catch (e) {
            context.ctx.logger.error(`Bot[${context.session.selfId}]戳了戳 ${user_id}，但是失败了 - `, e.message);
            return Failed(`戳了戳 ${user_id} 失败： ${e.message}`)
        }
    }
})
