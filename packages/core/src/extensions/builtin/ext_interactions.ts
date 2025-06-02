// ==Extension==
// @name         Interactions
// @version      1.0.0
// @description  允许大模型在聊群内进行交互
// @author       HydroGest
// ==/Extension==

import { z } from "zod";

import {} from 'koishi-plugin-adapter-onebot'

import { isEmpty } from "../../utils/string";
import { Failed, INNER_THOUGHTS, REQUEST_HEARTBEAT, Success, Tool } from "../base";

export const Reaction = Tool({
    name: "reaction-create",
    description: `在当前频道对一个或多个消息进行表态。表态编号是数字，这里是一个简略的参考：惊讶(0)，不适(1)，无语(27)，震惊(110)，滑稽(178), 点赞(76)`,
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        message_id: z.string().describe("消息 ID"),
        emoji_id: z.number().describe("表态编号"),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ message_id, emoji_id }, context) => {
        const { koishiContext, koishiSession } = context;
        if (isEmpty(message_id) || isEmpty(String(emoji_id))) return Failed("message_id and emoji_id is required");
        try {
            await koishiSession.onebot._request("set_msg_emoji_like", {
                message_id,
                emoji_id,
            });
            koishiContext.logger.info(`Bot[${koishiSession.selfId}]对消息 ${message_id} 进行了表态： ${emoji_id}`);
            return Success();
        } catch (e) {
            koishiContext.logger.error(`Bot[${koishiSession.selfId}]执行表态失败: ${message_id}, ${emoji_id} - `, e.message);
            return Failed(`对消息 ${message_id} 进行表态失败： ${e.message}`);
        }
    },
});

export const Essence = Tool({
    name: "essence-create",
    description: `在当前频道将一个消息设置为精华消息。常在你认为某个消息十分重要或过于典型时使用。`,
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        message_id: z.string().describe("消息 ID"),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ message_id }, context) => {
        const { koishiContext, koishiSession } = context;
        if (isEmpty(String(message_id))) return Failed("message_id is required");
        try {
            await koishiSession.onebot._request("set_essence_msg", { message_id });
            koishiContext.logger.info(`Bot[${koishiSession.selfId}]将消息 ${message_id} 设置为精华`);
            return Success();
        } catch (e) {
            koishiContext.logger.error(`Bot[${koishiSession.selfId}]设置精华消息失败: ${message_id} - `, e.message);
            return Failed(`设置精华消息失败： ${e.message}`);
        }
    },
});

export const Poke = Tool({
    name: "send-poke",
    description: `发送戳一戳、拍一拍消息，常用于指定你交流的对象，或提醒某位用户注意。`,
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        user_id: z.string().describe("用户名称"),
        channel: z.string().optional().describe("要在哪个频道运行，不填默认为当前频道"),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ user_id, channel }, context) => {
        const { koishiContext, koishiSession } = context;
        if (isEmpty(String(user_id))) return Failed("user_id is required");
        try {
            let channelId = isEmpty(channel) ? koishiSession.channelId : channel;
            if (!channelId.startsWith("private:")) {
                await koishiSession.onebot._request("send_poke", {
                    channel: channelId,
                    channelId: channelId,
                    group_id: channelId,
                    user_id: user_id,
                });
            } else {
                await koishiSession.onebot._request("send_poke", {
                    user_id: user_id,
                });
            }
            koishiContext.logger.info(`Bot[${koishiSession.selfId}]戳了戳 ${user_id}`);
            return Success();
        } catch (e) {
            koishiContext.logger.error(`Bot[${koishiSession.selfId}]戳了戳 ${user_id}，但是失败了 - `, e.message);
            return Failed(`戳了戳 ${user_id} 失败： ${e.message}`);
        }
    },
});
