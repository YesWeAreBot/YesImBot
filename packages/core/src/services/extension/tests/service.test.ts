// --- 运行与测试 ---

import { Context, Schema } from "koishi";
import { Extension, Tool } from "../decorators";
import { ToolService } from "../service";
import { type Infer } from "../types";

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
class WeatherExtension {
    public static readonly Config: Schema<WeatherConfig> = Schema.object({
        apiKey: Schema.string().required().description("天气服务的 API Key"),
        defaultCity: Schema.string().description("默认查询城市").default("上海"),
    });

    constructor(public ctx: Context, public config: WeatherConfig) {}

    /**
     * 声明为一个工具。
     */
    @Tool({
        name: "get_weather",
        description: "获取指定城市的天气信息",
        parameters: Schema.object({
            city: Schema.string().description("城市名称"),
        }),
        isSupported: (session) => session.platform === "qq",
    })
    protected async getWeather(args: Infer<{ city: string }>) {
        const apiKey = this.config.apiKey;
        console.log(`[getWeather] 正在使用 API Key "${apiKey}" 查询 "${args.city}" 的天气...`);
        return { city: args.city, weather: "晴朗" };
    }

    @Tool({
        name: "get_weather_by_ip",
        description: "根据 IP 地址获取天气信息",
        parameters: Schema.object({
            ip: Schema.string().description("IP 地址"),
        }),
    })
    protected async getWeatherByIP(args: Infer<{ ip: string }>) {
        return { ip: args.ip, weather: "多云" };
    }
}

@Extension({
    name: "test",
    description: "测试扩展",
    version: "1.0.0",
})
class TestExtension {
    // public static readonly Config: Schema<any> = Schema.object({});

    constructor(public ctx: Context, public config: any) {}

    @Tool({
        name: "test_tool",
        description: "测试工具",
        parameters: Schema.object({
            test: Schema.string().description("测试参数"),
        }),
    })
    protected async testTool(args: Infer<{ test: string }>) {
        return { test: args.test };
    }
}

async function main() {
    console.log("--- 系统初始化 ---");
    const toolManager = new ToolService(new Context(), { });
    // toolManager.register(WeatherExtension, { apiKey: "your-secret-api-key", defaultCity: "北京" });
    // toolManager.register(TestExtension, {});

    console.log("\n--- 测试从 ToolManager 获取并执行工具 ---");
    const tool = toolManager.getTool("get_weather");

    if (tool) {
        const result = await tool.execute({ city: "上海" });
        console.log("工具执行结果:", result);
    } else {
        console.error("错误：找不到名为 'get_weather' 的工具。");
    }

    console.log("\n--- 测试获取扩展实例 ---");
    const ext = toolManager.getExtension("weather");
    if (ext) {
        console.log("获取到的扩展实例配置:", ext.config);
    } else {
        console.error("错误：找不到名为 'weather' 的扩展。");
    }
    return;
}

main();
