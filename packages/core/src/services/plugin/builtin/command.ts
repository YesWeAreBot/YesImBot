import type { FunctionContext } from "@/services/plugin/types";

import { h, Schema } from "koishi";
import { Plugin } from "@/services/plugin/base-plugin";
import { Metadata, Tool, withInnerThoughts } from "@/services/plugin/decorators";
import { Failed, Success } from "@/services/plugin/utils";
import { Services } from "@/shared/constants";

/**
 * 指令执行工具（移植自 v3-legacy command 扩展）。
 * 向 IM 平台发送纯文本指令，触发平台或机器人插件的功能（签到、查询等）。
 */
@Metadata({
    name: "command",
    display: "指令执行",
    description: "执行Koishi指令",
    builtin: true,
})
export default class CommandPlugin extends Plugin<Record<string, never>> {
    static readonly inject = [Services.Plugin];
    static readonly Config = Schema.object({});

    @Tool({
        name: "send_platform_command",
        description:
            "用于向IM聊天平台发送一个【纯文本指令】，以触发平台或机器人插件的特定功能，例如签到、查询游戏角色信息等。这个工具【不能】执行任何代码、数学计算或调用其他工具。如果你需要编码、计算或查询天气，请直接调用对应的工具，而不是用这个工具包装它。",
        parameters: withInnerThoughts({
            command: Schema.string()
                .required()
                .description(
                    "要发送到平台的【纯文本指令字符串】。这【不应该】是代码或函数调用。例如：'今日人品'、'#天气 北京'。",
                ),
        }),
    })
    async executeCommand(params: { command: string }, context: FunctionContext) {
        const session = context.session;
        if (!session) {
            this.ctx.logger.warn("send_platform_command: 缺少会话上下文");
            return Failed("缺少会话上下文，无法执行指令");
        }

        const { command } = params;
        try {
            await session.sendQueued(h("execute", {}, command));
            this.ctx.logger.info(`Bot[${session.selfId}]执行了指令: ${command}`);
            return Success();
        } catch (error: any) {
            this.ctx.logger.error(`Bot[${session.selfId}]执行指令失败: ${command} - ${error.message}`);
            return Failed(`执行指令失败 - ${error.message}`);
        }
    }
}
