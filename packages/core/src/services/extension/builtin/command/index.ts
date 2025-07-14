import { Context, h, Schema } from "koishi";

import { Extension, Tool, withInnerThoughts } from "@/services/extension/decorators";
import { Failed, Success } from "@/services/extension/helpers";
import { Infer } from "@/services/extension/types";

@Extension({
    name: "command",
    display: "指令执行",
    description: "执行Koishi指令",
    version: "1.0.0",
})
export default class CommandExtension {
    static readonly Config = Schema.object({});

    constructor(public ctx: Context, public config: any) {}

    @Tool({
        name: "send_platform_command",
        description:
            "用于向IM聊天平台发送一个【纯文本指令】，以触发平台或机器人插件的特定功能，例如发送表情包、签到、查询游戏角色信息等。这个工具【不能】执行任何代码、数学计算或调用其他工具。如果你需要编码、计算或查询天气，请直接调用对应的工具，而不是用这个工具包装它。",
        parameters: withInnerThoughts({
            command: Schema.string()
                .required()
                .description(
                    "要发送到平台的【纯文本指令字符串】。这【不应该】是代码或函数调用。例如：'fufu表情包'、'今日人品'、'#天气 北京'。"
                ),
        }),
    })
    async executeKoishiCommand({ session, command }: Infer<{ command: string }>) {
        try {
            const result = await session.sendQueued(h("execute", {}, command));

            if (result.length === 0) return Failed("指令执行失败，可能是因为指令不存在或格式错误。");

            this.ctx.logger.info(`Bot[${session.selfId}]执行了指令: ${command}`);
            return Success();
        } catch (e) {
            this.ctx.logger.error(`Bot[${session.selfId}]执行指令失败: ${command} - `, e.message);
            return Failed(`执行指令失败 - ${e.message}`);
        }
    }
}
