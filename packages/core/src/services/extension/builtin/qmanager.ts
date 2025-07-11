import { Context, Schema } from "koishi";
import { Extension, Tool } from "../decorators";
import { Failed, Success } from "../helpers";
import { Infer } from "../types";
import { isEmpty } from "@/shared";

@Extension({
    name: "qmanager",
    display: "频道管理",
    version: "1.0.0",
    description: "管理频道内用户和消息",
})
export default class QManagerExtension {
    static readonly Config = Schema.object({});

    constructor(public ctx: Context, public config: any) {}

    @Tool({
        name: "delmsg",
        description: `撤回一条消息。撤回用户/你自己的消息。当你认为别人刷屏或发表不当内容时，运行这条指令。`,
        parameters: Schema.object({
            message: Schema.string().required().description("要撤回的消息编号"),
            channel: Schema.string().description("要在哪个频道运行，不填默认为当前频道"),
        }),
    })
    async delmsg({ session, message, channel }: Infer<{ message: string; channel: string }>) {
        if (isEmpty(message)) return Failed("message is required");
        const targetChannel = isEmpty(channel) ? session.channelId : channel;
        try {
            await session.bot.deleteMessage(targetChannel, message);
            this.ctx.logger.info(`Bot[${session.selfId}]撤回了消息: ${message}`);
            return Success();
        } catch (e) {
            this.ctx.logger.error(`Bot[${session.selfId}]撤回消息失败: ${message} - `, e.message);
            return Failed(`撤回消息失败 - ${e.message}`);
        }
    }

    @Tool({
        name: "ban",
        description: `禁言用户。`,
        parameters: Schema.object({
            user_id: Schema.string().required().description("要禁言的用户 ID"),
            duration: Schema.number()
                .required()
                .description("禁言时长，单位为分钟。你不应该禁言他人超过 10 分钟。时长设为 0 表示解除禁言。"),
            channel: Schema.string().description("要在哪个频道运行，不填默认为当前频道"),
        }),
    })
    async ban({ session, user_id, duration, channel }: Infer<{ user_id: string; duration: number; channel: string }>) {
        if (isEmpty(user_id)) return Failed("user_id is required");
        const targetChannel = isEmpty(channel) ? session.channelId : channel;
        try {
            await session.bot.muteGuildMember(targetChannel, user_id, duration * 60 * 1000);
            this.ctx.logger.info(`Bot[${session.selfId}]在频道 ${channel} 禁言用户: ${user_id}`);
            return Success();
        } catch (e) {
            this.ctx.logger.error(`Bot[${session.selfId}]在频道 ${channel} 禁言用户: ${user_id} 失败 - `, e.message);
            return Failed(`禁言用户 ${user_id} 失败 - ${e.message}`);
        }
    }

    @Tool({
        name: "kick",
        description: `踢出用户。`,
        parameters: Schema.object({
            user_id: Schema.string().required().description("要踢出的用户 ID"),
            channel: Schema.string().description("要在哪个频道运行，不填默认为当前频道"),
        }),
    })
    async kick({ session, user_id, channel }: Infer<{ user_id: string; channel: string }>) {
        if (isEmpty(user_id)) return Failed("user_id is required");
        const targetChannel = isEmpty(channel) ? session.channelId : channel;
        try {
            await session.bot.kickGuildMember(targetChannel, user_id);
            this.ctx.logger.info(`Bot[${session.selfId}]在频道 ${channel} 踢出了用户: ${user_id}`);
            return Success();
        } catch (e) {
            this.ctx.logger.error(`Bot[${session.selfId}]在频道 ${channel} 踢出用户: ${user_id} 失败 - `, e.message);
            return Failed(`踢出用户 ${user_id} 失败 - ${e.message}`);
        }
    }
}
