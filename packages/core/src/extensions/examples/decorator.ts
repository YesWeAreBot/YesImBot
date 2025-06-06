// ===== 示例3: 装饰器方式 =====

import { z } from "zod";
import { Extension, Tool, Params, ExtensionConstructor } from "../decorators";
import { withCommonParams, Success, Failed } from "../helpers";

@Extension({
    name: "example-extension",
    version: "1.0.0",
    description: "示例插件",
    author: "开发者",
    homepage: "https://github.com/example/example-extension",
    license: "MIT",
    keywords: ["example", "demo"],
})
export class ExampleExtension {
    @Tool("execute")
    @Params(
        withCommonParams({
            cmd: z.string().min(1).describe("要执行的指令内容"),
            channel: z.string().optional().describe("目标频道ID，不填则在当前频道执行"),
            silent: z.boolean().optional().default(false).describe("是否静默执行（不显示执行结果）"),
        })
    )
    async execute({ cmd, channel, silent, inner_thoughts, request_heartbeat }, context) {
        const { koishiContext, koishiSession } = context;

        if (!koishiContext || !koishiSession) {
            return Failed("缺少必要的Koishi上下文或会话对象");
        }

        try {
            const targetChannel = channel || koishiSession.channelId;

            // 执行指令
            const result = await koishiSession.execute(cmd);

            return Success({
                command: cmd,
                executed: true,
                channel: targetChannel,
                result: silent ? undefined : result,
            });
        } catch (error) {
            return Failed(`执行指令失败: ${(error as Error).message}`);
        }
    }

    @Tool({
        name: "run_command",
        description: "运行系统命令",
        category: "System",
        tags: ["command", "system"],
    })
    @Params(
        z.object({
            cmd: z.string().min(1).describe("要执行的指令内容"),
            timeout: z.number().optional().default(10000).describe("超时时间（毫秒）"),
        })
    )
    async runCommand({ cmd, timeout }, context) {
        const { koishiContext } = context;

        try {
            koishiContext?.logger.info(`模拟执行命令: ${cmd}`);

            return Success({
                command: cmd,
                output: `模拟执行结果: ${cmd}`,
                exitCode: 0,
            });
        } catch (error) {
            return Failed(`命令执行失败: ${(error as Error).message}`);
        }
    }

    @Tool("get_system_info")
    @Params(
        z.object({
            detail: z.boolean().optional().default(false).describe("是否返回详细信息"),
        })
    )
    async getSystemInfo({ detail }, context) {
        const basicInfo = {
            platform: process.platform,
            nodeVersion: process.version,
            uptime: process.uptime(),
        };

        if (detail) {
            return Success({
                ...basicInfo,
                memory: process.memoryUsage(),
                cpu: process.cpuUsage(),
                env: process.env.NODE_ENV,
            });
        }

        return Success(basicInfo);
    }
}

// 确保类型正确的扩展定义获取
const ExtensionClass = ExampleExtension as typeof ExampleExtension & ExtensionConstructor;

// 获取扩展定义（用于注册）
export default ExtensionClass.getExtensionDefinition();

// 或者你可以这样使用类型断言（如果需要的话）
// export default (ExampleExtension as any).getExtensionDefinition();

// 也可以提供一个便捷的导出函数
export function getExtensionDefinition() {
    return (ExampleExtension as typeof ExampleExtension & ExtensionConstructor).getExtensionDefinition();
}
