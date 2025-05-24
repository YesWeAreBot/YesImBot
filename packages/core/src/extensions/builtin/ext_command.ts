// ==Extension==
// @name         Command Run
// @version      1.0.0
// @description  允许大模型调用自身指令
// @author       MiaowFISH
// ==/Extension==

import { h } from "koishi";
import { z } from "zod";

import { isEmpty } from "../../utils/string";
import { Failed, INNER_THOUGHTS, REQUEST_HEARTBEAT, Success, Tool } from "../base";


export const Execute = Tool({
    name: "execute",
    description: `执行一些只有在IM平台才能使用的指令。
  - 将指令字符串添加到 cmd 参数上来执行指令。
  - 将channel设置为你要执行指令的频道，不填默认为当前频道。
  Example:
    execute("fufu表情包", "123456789")`,
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        cmd: z.string().describe("要运行的指令"),
        channel: z.string().optional().describe("要在哪个频道运行，不填默认为当前频道"),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ cmd, channel }, context) => {
        if (isEmpty(cmd)) return Failed("cmd is required");
        try {
            if (isEmpty(channel) || channel == context.session.channelId) {
                await context.session.execute(cmd);
            } else {
                await context.session.bot.sendMessage(channel, h("execute", {}, cmd));
            }
            context.ctx.logger.info(`Bot[${context.session.selfId}]执行了指令: ${cmd}`);
            return Success();
        } catch (e) {
            context.ctx.logger.error(`Bot[${context.session.selfId}]执行指令失败: ${cmd} - `, e.message);
            return Failed(`执行指令失败 - ${e.message}`)
        }
    }
})
