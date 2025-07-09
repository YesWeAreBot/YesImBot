import { h, Schema } from "koishi";

import { Extension, Tool } from "@/services/extension/decorators";
import { BaseExtension, Failed, Success } from "@/services/extension/helpers";
import { Infer } from "@/services/extension/types";
import { isEmpty } from "@/shared";

@Extension({
    name: "command",
    description: "执行Koishi指令",
    version: "1.0.0",
})
export default class CommandExtension extends BaseExtension<any> {
    static readonly Config = Schema.object({});

    @Tool({
        name: "send_platform_command",
        description:
            "用于向IM聊天平台发送一个【纯文本指令】，以触发平台或机器人插件的特定功能，例如发送表情包、签到、查询游戏角色信息等。这个工具【不能】执行任何代码、数学计算或调用其他工具。如果你需要编码、计算或查询天气，请直接调用对应的工具，而不是用这个工具包装它。",
        parameters: Schema.object({
            inner_thoughts: Schema.string().description("执行此操作前的内心思考过程，用于自我反思和记录。"),
            command_text: Schema.string().description(
                "要发送到平台的【纯文本指令字符串】。这【不应该】是代码或函数调用。例如：'fufu表情包'、'今日人品'、'#天气 北京'。"
            ),
        }),
    })
    async executeKoishiCommand({ session, command_text }: Infer<{ command_text: string }>) {
        if (isEmpty(command_text)) return Failed("cmd is required");

        try {
            await session.sendQueued(h("execute", {}, command_text));

            this.ctx.logger.info(`Bot[${session.selfId}]执行了指令: ${command_text}`);
            return Success();
        } catch (e) {
            this.ctx.logger.error(`Bot[${session.selfId}]执行指令失败: ${command_text} - `, e.message);
            return Failed(`执行指令失败 - ${e.message}`);
        }
    }
}
