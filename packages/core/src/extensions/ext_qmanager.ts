// ==Extension==
// @name         QQ Group Manager
// @version      1.0.0
// @description  让大模型可以管理 QQ 群
// @author       HydroGest
// ==/Extension==

import { SchemaNode } from "../adapters/creators/schema";
import { isEmpty } from "../utils/string";
import { Description, Extension, Name, Param } from "./base";

@Name("delmsg")
@Description(`撤回一条消息。撤回用户/你自己的消息。当你认为别人刷屏或发表不当内容时，运行这条指令。`)
@Param("message", "要撤回的消息编号")
@Param("channel", SchemaNode.String("要在哪个频道运行，不填默认为当前频道", ""))
export class DeleteMsg extends Extension {
    async apply(args: { message: string; channel?: string }) {
        const { message, channel } = args;
        try {
            if (isEmpty(channel)) {
                await this.session.bot.deleteMessage(this.session.guildId, message);
            } else {
                await this.session.bot.deleteMessage(channel, message);
            }
            this.ctx.logger.info(`Bot[${this.session.selfId}]撤回了消息: ${message}`);
        } catch (e) {
            this.ctx.logger.error(`Bot[${this.session.selfId}]撤回消息失败: ${message} - `, e.message);
        }
    }
}

@Name("ban")
@Description(`禁言用户`)
@Param("user_id", "要禁言的用户 ID")
@Param("duration", "禁言时长，单位为分钟。你不应该禁言他人超过 10 分钟。时长设为 0 表示解除禁言。")
@Param("channel", SchemaNode.String("要在哪个频道运行，不填默认为当前频道", ""))
export class BanUser extends Extension {
    async apply(args: { user_id: string; duration: number; channel?: string }) {
        const { user_id, duration, channel } = args;
        try {
            if (isEmpty(channel)) {
                await this.session.bot.muteGuildMember(this.session.guildId, user_id, (duration ? Number(duration) * 60000 : 10 * 60000));
            } else {
                await this.session.bot.muteGuildMember(channel, user_id, (duration ? Number(duration) * 60000 : 10 * 60000));
            }
            this.ctx.logger.info(`Bot[${this.session.selfId}]在频道 ${channel} 禁言用户: ${user_id}`);
        } catch (e) {
            this.ctx.logger.error(`Bot[${this.session.selfId}]在频道 ${channel} 禁言用户: ${user_id} 失败 - `, e.message);
        }
    }
}