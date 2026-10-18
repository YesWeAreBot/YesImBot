import { randomUUID } from "node:crypto";

import { Context, h, Schema } from "koishi";

import { guardReplySession } from "../../../agent/reply-turn";
import { Extension, Tool, withInnerThoughts } from "../../../extension/decorators";
import { Failed, Success } from "../../../extension/helpers";
import { Infer } from "../../../extension/types";

@Extension({
    name: "command",
    display: "指令执行",
    description: "执行Koishi指令",
    version: "1.0.0",
    builtin: true,
})
export default class CommandExtension {
    static readonly Config = Schema.object({});

    constructor(
        public ctx: Context,
        public config: any,
    ) {}

    @Tool({
        name: "send_platform_command",
        description:
            "以机器人自己的账号和权限，在当前会话执行一个【纯文本指令】，例如签到、查询游戏角色信息等；不会代替触发对话的用户操作其账号。这个工具【不能】执行任何代码、数学计算或调用其他工具。如果你需要编码、计算或查询天气，请直接调用对应的工具，而不是用这个工具包装它。",
        parameters: withInnerThoughts({
            command: Schema.string()
                .required()
                .description("要发送到平台的【纯文本指令字符串】。这【不应该】是代码或函数调用。例如：'今日人品'、'#天气 北京'。"),
        }),
    })
    async executeKoishiCommand({ session, command }: Infer<{ command: string }>) {
        if (!session) return Failed("session 不可用");
        try {
            // A fresh session prevents the trigger's observed user/permissions/member
            // from leaking into command execution. Keep the destination independently
            // from the actor, especially for a private conversation with another user.
            const commandSession = guardReplySession(
                session.bot.session({
                    type: "message",
                    channel: session.event.channel ? { ...session.event.channel } : undefined,
                    guild: session.event.guild ? { ...session.event.guild } : undefined,
                    referrer: session.event.referrer,
                    user: { ...session.bot.user, id: session.selfId },
                    message: { id: `bot-command-${randomUUID()}`, content: command },
                }),
            );
            await commandSession.sendQueued(h("execute", {}, command));

            this.ctx.logger.info(`Bot[${session.selfId}]执行了指令: ${command}`);
            return Success();
        } catch (error) {
            this.ctx.logger.error(`Bot[${session.selfId}]执行指令失败: ${command} - `, error.message);
            return Failed(`执行指令失败 - ${error.message}`);
        }
    }
}
