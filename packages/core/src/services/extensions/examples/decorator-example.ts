import { Schema } from "koishi";
import { Extension, Params, Tool } from "../decorators";
import { Failed, Success, withCommonParams } from "../helpers";

@Extension({
    name: "decorator-example",
    description: "使用装饰器定义的示例，带配置功能。",
    version: "1.0.0",
    schema: Schema.object({
        defaultPrefix: Schema.string().default("CMD_OUTPUT").description("模拟命令输出的前缀"),
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
            cmd: Schema.string().min(1).description("要执行的指令内容"),
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
