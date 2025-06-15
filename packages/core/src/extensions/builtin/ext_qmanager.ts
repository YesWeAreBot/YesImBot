import { Schema } from "koishi";
import { isEmpty } from "../../utils/string";
import { createTool, Failed, Success, withCommonParams } from "../helpers";

export const DeleteMsg = createTool({
    name: "delmsg",
    description: `撤回一条消息。撤回用户/你自己的消息。当你认为别人刷屏或发表不当内容时，运行这条指令。`,
    parameters: withCommonParams({
        message: Schema.string().required().description("要撤回的消息编号"),
        channel: Schema.string().description("要在哪个频道运行，不填默认为当前频道"),
    }),
    execute: async ({ message, channel }, context) => {
        const { koishiContext, koishiSession, platform } = context;
        if (isEmpty(message)) throw new Error("message is required");
        const targetChannel = isEmpty(channel) ? koishiSession.channelId : channel;
        try {
            await platform.deleteMessage(message, targetChannel);
            koishiContext.logger.info(`Bot[${koishiSession.selfId}]撤回了消息: ${message}`);
            return Success();
        } catch (e) {
            koishiContext.logger.error(`Bot[${koishiSession.selfId}]撤回消息失败: ${message} - `, e.message);
            return Failed(`撤回消息失败 - ${e.message}`);
        }
    },
});

export const BanUser = createTool({
    name: "ban",
    description: `禁言用户。`,
    parameters: withCommonParams({
        user_id: Schema.string().required().description("要禁言的用户 ID"),
        duration: Schema.number().required().description("禁言时长，单位为分钟。你不应该禁言他人超过 10 分钟。时长设为 0 表示解除禁言。"),
        channel: Schema.string().description("要在哪个频道运行，不填默认为当前频道"),
    }),
    execute: async ({ user_id, duration, channel }, context) => {
        const { koishiContext, koishiSession, platform } = context;
        if (isEmpty(user_id)) throw new Error("user_id is required");
        const targetChannel = isEmpty(channel) ? koishiSession.channelId : channel;
        try {
            await platform.muteMember(user_id, targetChannel, duration);
            koishiContext.logger.info(`Bot[${koishiSession.selfId}]在频道 ${channel} 禁言用户: ${user_id}`);
            return Success();
        } catch (e) {
            koishiContext.logger.error(`Bot[${koishiSession.selfId}]在频道 ${channel} 禁言用户: ${user_id} 失败 - `, e.message);
            return Failed(`禁言用户 ${user_id} 失败 - ${e.message}`);
        }
    },
});
