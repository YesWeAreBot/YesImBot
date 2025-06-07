import { z } from "zod";
import { Extension, Tool, Params } from "../decorators";
import { Success, Failed, withCommonParams } from "../helpers";

@Extension({
    name: "decorator-example",
    description: "使用装饰器定义的示例，带配置功能。",
    version: "1.0.0",
    schema: z.object({
        defaultPrefix: z.string().default("CMD_OUTPUT").describe("模拟命令输出的前缀"),
    }),
})
export default class DecoratorExample {
    @Tool({
        name: "run_decorated_command",
        description: "运行一个通过装饰器定义的模拟命令",
        category: "System",
    })
    @Params(
        withCommonParams({
            cmd: z.string().min(1).describe("要执行的指令内容"),
        })
    )
    async runCommand({ cmd }, context) {
        // context.extensionConfig 是类型安全的
        const { defaultPrefix } = context.extensionConfig;
        try {
            context.koishiContext?.logger.info(`[Decorator] 模拟执行: ${cmd}`);
            return Success({ output: `${defaultPrefix}: ${cmd}` });
        } catch (error) {
            return Failed(`命令执行失败: ${(error as Error).message}`);
        }
    }
}
