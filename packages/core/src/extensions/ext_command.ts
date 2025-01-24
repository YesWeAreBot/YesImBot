// ==Extension==
// @name         Command Run
// @version      1.0.0
// @description  允许大模型调用自身指令
// @author       MiaowFISH
// ==/Extension==

import { h } from "koishi";

import { SchemaNode } from "../adapters/creators/schema";
import { isEmpty } from "../utils/string";
import { Description, Extension, Name, Param } from "./base";

// TODO: 增加一个配置，允许用户自己填入让Bot运行的指令
// TODO: 可以内置一些常用的指令
// 或者说，和之前一样将指令功能独立出来
@Name("execute")
@Description(`
  你可以运行一些只有在IM平台才能运行的指令，下面是你可以运行的指令列表。
  - ban <用户ID> <时长>: 将用户禁言。单位为秒。
  - delmsg <消息ID>: 撤回用户的消息。当你认为别人刷屏或发表不当内容时，运行这条指令
  请将指令字符串添加到 cmd 参数上来执行指令。
  将channel设置为你要执行指令的频道，不填默认为当前频道。
  比如 \`execute("ban 1234567 600")\` 是将用户 1234567 禁言 10 分钟。
  这个函数**不能**在 "status" 为 function 的时候使用。DO NOT USE THIS FUNCTION WHEN "status" IS "function".
  你只能在 "status" 为 "success" 或 "skip" 的时候使用这个函数。YOU CAN ONLY USE THIS FUNCTION WHEN "status" IS "success" OR "skip".
  这个函数没有返回值。
  请务必将此处可以运行的指令与你允许调用的函数区分开来。
  注意这个函数的名字是 \`execute\` 而不是你要运行的指令。`)
@Param("cmd", "要运行的指令")
@Param("channel", SchemaNode.String("要在哪个频道运行，不填默认为当前频道", ""))
export class Execute extends Extension {
  async apply(args: { cmd: string; channel?: string }) {
    const { cmd, channel } = args;
    if (isEmpty(cmd)) throw new Error("cmd is required");
    try {
      if (isEmpty(channel) || channel == this.session.channelId) {
        await this.session.execute(cmd);
      } else {
        await this.session.bot.sendMessage(channel, h("execute", {}, cmd));
      }
      this.ctx.logger.info(`Bot[${this.session.selfId}]执行了指令: ${cmd}`);
    } catch (e) {
      this.ctx.logger.error(`Bot[${this.session.selfId}]执行指令失败: ${cmd} - `, e.message);
    }
  }
}
