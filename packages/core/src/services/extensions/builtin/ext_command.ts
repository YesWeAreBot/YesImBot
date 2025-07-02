import { h, Schema } from "koishi";

import { createExtension, createTool, Failed, Success, withCommonParams } from "../helpers";
import { ExtensionMetadata } from "../types";
import { isEmpty } from "../../../shared";

const metadata: ExtensionMetadata = {
    name: "Execute",
    description: "允许执行Koishi指令",
    version: "1.0.0",
    author: "",
};

const ExecuteTool = createTool({
    name: "execute",
    description: `执行一些只有在IM平台才能使用的指令。
  - 将指令字符串添加到 cmd 参数上来执行指令。
  Example:
    execute("fufu表情包", "123456789")`,
    parameters: withCommonParams({
        cmd: Schema.string().description("要运行的指令"),
    }),
    hooks: {
        onRegister({ koishiContext }) {
            koishiContext.logger.info(`工具已注册`);
        },
    },
    execute: async (ctx, { cmd, channel }) => {
        const { koishiContext, koishiSession } = ctx;

        if (isEmpty(cmd)) return Failed("cmd is required");

        try {
            const targetChannel = isEmpty(channel) ? koishiSession.channelId : channel;
            await koishiSession.sendQueued(h("execute", {}, cmd));

            koishiContext.logger.info(`Bot[${koishiSession.selfId}]执行了指令: ${cmd}`);
            return Success();
        } catch (e) {
            koishiContext.logger.error(`Bot[${koishiSession.selfId}]执行指令失败: ${cmd} - `, e.message);
            return Failed(`执行指令失败 - ${e.message}`);
        }
    },
});

export default createExtension({
    metadata,
    tools: [ExecuteTool],
});
