// ==Extension==
// @name         Interactions
// @version      1.0.0
// @description  允许大模型在聊群内进行交互
// @author       HydroGest
// ==/Extension==

import { Description, Extension, Name, Param } from "./base";

import { isEmpty } from "../utils/string";

@Name("reaction-create")
@Description(`在当前频道对一个或多个消息进行表态。表态编号是数字，这里是一个简略的参考：惊讶(0)，不适(1)，无语(27)，震惊(110)，滑稽(178), 点赞(76)`)
@Param("message", "消息 ID")
@Param("emoji_id", "表态编号")
export class Reaction extends Extension {
    async apply(args: { message: number, emoji_id: number }) {
        const { message, emoji_id } = args;
        try {
            // @ts-ignore
            await this.session.onebot._request("set_msg_emoji_like", { message_id: message, emoji_id: emoji_id });
            this.ctx.logger.info(`Bot[${this.session.selfId}]对消息 ${message} 进行了表态： ${emoji_id}`);
        } catch (e) {
            this.ctx.logger.error(`Bot[${this.session.selfId}]执行表态失败: ${message}, ${emoji_id} - `, e.message);
        }
    }
}

@Name("essence-create")
@Description(`在当前频道将一个消息设置为精华消息。常在你认为某个消息十分重要或过于典型时使用。`)
@Param("message", "消息 ID")
export class Essence extends Extension {
    async apply(args: { message: number }) {
        const { message } = args;
        try {
            // @ts-ignore
            await this.session.onebot._request("set_essence_msg", { message_id: message })
            this.ctx.logger.info(`Bot[${this.session.selfId}]将消息 ${message} 设置为精华`);
        } catch (e) {
            this.ctx.logger.error(`Bot[${this.session.selfId}]设置精华消息失败: ${message} - `, e.message);
        }
    }
}

@Name("send-poke")
@Description(`
  发送戳一戳、拍一拍消息，常用于指定你交流的对象，或提醒某位用户注意。
`)
@Param("channel", "要在哪个频道运行，不填默认为当前频道")
@Param("user_id", "用户名称")
export class Poke extends Extension {
    async apply(args: { user_id: string, channel?: string }) {
        const { user_id, channel } = args;
        try {
            let channelId: string;
            if (isEmpty(channel)) {
                channelId = this.session.channelId;
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
            this.ctx.logger.info(`Bot[${this.session.selfId}]戳了戳 ${user_id}`);
        } catch (e) {
            this.ctx.logger.error(`Bot[${this.session.selfId}]戳了戳 ${user_id}，但是失败了 - `, e.message);
        }
    }
}

