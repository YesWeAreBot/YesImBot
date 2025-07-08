import { h, Schema } from "koishi";

import { isEmpty } from "../../../shared";
import { createExtension, createTool, Failed, Success } from "../helpers";
import { ExtensionMetadata } from "../types";

const metadata: ExtensionMetadata = {
    name: "Execute",
    description: "允许执行Koishi指令",
    version: "1.0.0",
    author: "",
};

const SendPlatformCommand = createTool({
    name: "send_platform_command",
    description: `用于向IM聊天平台发送一个【纯文本指令】，以触发平台或机器人插件的特定功能，例如发送表情包、签到、查询游戏角色信息等。这个工具【不能】执行任何代码、数学计算或调用其他工具。如果你需要编码、计算或查询天气，请直接调用对应的工具，而不是用这个工具包装它。`,
    parameters: Schema.object({
        inner_thoughts: Schema.string().description("执行此操作前的内心思考过程，用于自我反思和记录。"),

        // 3. 重写参数描述，明确其内容限制
        command_text: Schema.string().description(
            "要发送到平台的【纯文本指令字符串】。这【不应该】是代码或函数调用。例如：'fufu表情包'、'今日人品'、'#天气 北京'。"
        ),
    }),
    hooks: {
        onRegister({ koishiContext, logger }) {
            logger.info(`工具已注册`);
        },
    },
    execute: async (ctx, { command_text }) => {
        const { koishiContext, koishiSession, logger } = ctx;

        if (isEmpty(command_text)) return Failed("cmd is required");

        try {
            await koishiSession.sendQueued(h("execute", {}, command_text));

            logger.info(`Bot[${koishiSession.selfId}]执行了指令: ${command_text}`);
            return Success();
        } catch (e) {
            logger.error(`Bot[${koishiSession.selfId}]执行指令失败: ${command_text} - `, e.message);
            return Failed(`执行指令失败 - ${e.message}`);
        }
    },
});

export default createExtension({
    metadata,
    tools: [SendPlatformCommand],
});
