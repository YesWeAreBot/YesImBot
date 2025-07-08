// --- 运行与测试 ---

import { Schema, Context } from "koishi";
import { ToolService } from "../service";
import { BaseExtension, type Infer } from "../types";
import { Extension, Tool } from "../decorators";

/**
 * 天气查询扩展的具体实现。
 */
interface WeatherConfig {
    apiKey: string;
    defaultCity: string;
}

@Extension({
    name: "weather",
    description: "获取天气信息",
    version: "1.0.0",
})
class WeatherExtension extends BaseExtension<WeatherConfig> {
    // Koishi 插件的标准配置定义
    public static readonly Config: Schema<WeatherConfig> = Schema.object({
        apiKey: Schema.string().description("天气服务的 API Key").required(),
        defaultCity: Schema.string().description("默认查询城市").default("上海"),
    });

    // 构造函数，只需调用父类的构造函数即可
    constructor(ctx: Context, config: WeatherConfig) {
        super(ctx, config);
    }

    /**
     * @Tool 装饰器将此方法声明为一个工具。
     * 所有关于 `this` 的复杂性都已由 BaseExtension 处理。
     */
    @Tool({
        name: "get_weather",
        description: "获取指定城市的天气信息",
        parameters: Schema.object({
            city: Schema.string().description("城市名称"),
        }),
    })
    protected async getWeather(args: Infer<{ city: string }>) {
        // 这里的 `this` 已经被正确绑定，可以安全地访问 `this.config`
        const apiKey = this.config.apiKey;
        console.log(`[getWeather] 正在使用 API Key "${apiKey}" 查询 "${args.city}" 的天气...`);
        return { city: args.city, weather: "晴朗" };
    }
}

async function main() {
    console.log("--- 系统初始化 ---");
    const toolManager = new ToolService(new Context(), {});
    toolManager.register(WeatherExtension, { apiKey: "your-secret-api-key", defaultCity: "北京" });

    console.log("\n--- 测试从 ToolManager 获取并执行工具 ---");
    const tool = toolManager.getTool("get_weather");

    if (tool) {
        const result = await tool.execute({ city: "上海" });
        console.log("工具执行结果:", result);
    } else {
        console.error("错误：找不到名为 'get_weather' 的工具。");
    }

    console.log("\n--- 测试获取扩展实例 ---");
    const ext = toolManager.getExt("weather");
    console.log("获取到的扩展实例配置:", ext?.config);
}

main();
