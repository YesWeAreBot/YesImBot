import { Context, Schema } from "koishi";

import { Extension, Tool, withInnerThoughts } from "@/services/extension/decorators";
import { Failed, Success } from "@/services/extension/helpers";
import { WithSession } from "@/services/extension/types";
import { isEmpty } from "@/shared/utils";

@Extension({
    name: "qmanager",
    display: "频道管理",
    version: "1.0.0",
    description: "管理频道内用户和消息",
    author: "HydroGest",
    builtin: true,
})
export default class QManagerExtension {
    static readonly Config = Schema.object({});

    constructor(
        public ctx: Context,
        public config: any
    ) {}

    @Tool({
        name: "delmsg",
        description: `撤回一条消息。撤回用户/你自己的消息。当你认为别人刷屏或发表不当内容时，运行这条指令。`,
        parameters: withInnerThoughts({
            message_id: Schema.string().required().description("要撤回的消息编号"),
            channel_id: Schema.string().description("要在哪个频道运行，不填默认为当前频道"),
        }),
    })
    async delmsg({ session, message_id, channel_id }: WithSession<{ message_id: string; channel_id: string }>) {
        const targetChannel = isEmpty(channel_id) ? session.channelId : channel_id;
        try {
            await session.bot.deleteMessage(targetChannel, message_id);
            this.ctx.logger.info(`Bot[${session.selfId}]撤回了消息: ${message_id}`);
            return Success();
        } catch (e) {
            this.ctx.logger.error(`Bot[${session.selfId}]撤回消息失败: ${message_id} - `, e.message);
            return Failed(`撤回消息失败 - ${e.message}`);
        }
    }

    @Tool({
        name: "ban",
        description: `禁言用户。`,
        parameters: withInnerThoughts({
            user_id: Schema.string().required().description("要禁言的用户 ID"),
            duration: Schema.union([String, Number])
                .required()
                .description("禁言时长，单位为分钟。你不应该禁言他人超过 10 分钟。时长设为 0 表示解除禁言。"),
            channel_id: Schema.string().description("要在哪个频道运行，不填默认为当前频道"),
        }),
    })
    async ban({ session, user_id, duration, channel_id }: WithSession<{ user_id: string; duration: number; channel_id: string }>) {
        if (isEmpty(user_id)) return Failed("user_id is required");
        const targetChannel = isEmpty(channel_id) ? session.channelId : channel_id;
        try {
            await session.bot.muteGuildMember(targetChannel, user_id, Number(duration) * 60 * 1000);
            this.ctx.logger.info(`Bot[${session.selfId}]在频道 ${channel_id} 禁言用户: ${user_id}`);
            return Success();
        } catch (e) {
            this.ctx.logger.error(`Bot[${session.selfId}]在频道 ${channel_id} 禁言用户: ${user_id} 失败 - `, e.message);
            return Failed(`禁言用户 ${user_id} 失败 - ${e.message}`);
        }
    }

    @Tool({
        name: "kick",
        description: `踢出用户。`,
        parameters: withInnerThoughts({
            user_id: Schema.string().required().description("要踢出的用户 ID"),
            channel_id: Schema.string().description("要在哪个频道运行，不填默认为当前频道"),
        }),
    })
    async kick({ session, user_id, channel_id }: WithSession<{ user_id: string; channel_id: string }>) {
        if (isEmpty(user_id)) return Failed("user_id is required");
        const targetChannel = isEmpty(channel_id) ? session.channelId : channel_id;
        try {
            await session.bot.kickGuildMember(targetChannel, user_id);
            this.ctx.logger.info(`Bot[${session.selfId}]在频道 ${channel_id} 踢出了用户: ${user_id}`);
            return Success();
        } catch (e) {
            this.ctx.logger.error(`Bot[${session.selfId}]在频道 ${channel_id} 踢出用户: ${user_id} 失败 - `, e.message);
            return Failed(`踢出用户 ${user_id} 失败 - ${e.message}`);
        }
    }
}
