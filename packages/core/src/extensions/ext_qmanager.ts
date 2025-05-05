// ==Extension==
// @name         QQ Group Manager
// @version      1.0.0
// @description  让大模型可以管理 QQ 群
// @author       HydroGest
// ==/Extension==

import { z } from "zod";

import { isEmpty } from "../utils/string";
import { Failed, INNER_THOUGHTS, REQUEST_HEARTBEAT, Success, Tool } from "./base";


export const DeleteMsg = Tool({
    name: "delmsg",
    description: `撤回一条消息。撤回用户/你自己的消息。当你认为别人刷屏或发表不当内容时，运行这条指令。`,
    parameters: z.object({
        INNER_THOUGHTS,
        message: z.string().describe("要撤回的消息编号"),
        channel: z.string().optional().describe("要在哪个频道运行，不填默认为当前频道"),
        REQUEST_HEARTBEAT,
    }),
    execute: async ({ message, channel }, context) => {
        if (isEmpty(message)) throw new Error("message is required");
        try {
            if (isEmpty(channel)) {
                await context.session.bot.deleteMessage(context.session.guildId, message);
            } else {
                await context.session.bot.deleteMessage(channel, message);
            }
            context.ctx.logger.info(`Bot[${context.session.selfId}]撤回了消息: ${message}`);
            return Success(`撤回消息 ${message} 成功`);
        } catch (e) {
            context.ctx.logger.error(`Bot[${context.session.selfId}]撤回消息失败: ${message} - `, e.message);
            return Failed(`撤回消息失败 - ${e.message}`)
        }
    }
})

export const BanUser = Tool({
    name: "ban",
    description: `禁言用户。`,
    parameters: z.object({
        INNER_THOUGHTS,
        user_id: z.string().describe("要禁言的用户 ID"),
        duration: z.number().optional().describe("禁言时长，单位为分钟。你不应该禁言他人超过 10 分钟。时长设为 0 表示解除禁言。"),
        channel: z.string().optional().describe("要在哪个频道运行，不填默认为当前频道"),
        REQUEST_HEARTBEAT,
    }),
    execute: async ({ user_id, duration, channel }, context) => {
        if (isEmpty(user_id)) throw new Error("user_id is required");
        try {
            if (isEmpty(channel)) {
                await context.session.bot.muteGuildMember(context.session.guildId, user_id, (duration ? Number(duration) * 60000 : 10 * 60000));
            } else {
                await context.session.bot.muteGuildMember(channel, user_id, (duration ? Number(duration) * 60000 : 10 * 60000));
            }
            context.ctx.logger.info(`Bot[${context.session.selfId}]在频道 ${channel} 禁言用户: ${user_id}`);
            return Success(`禁言用户 ${user_id} 成功`);
        } catch (e) {
            context.ctx.logger.error(`Bot[${context.session.selfId}]在频道 ${channel} 禁言用户: ${user_id} 失败 - `, e.message);
            return Failed(`禁言用户 ${user_id} 失败 - ${e.message}`)
        }
    }
})
