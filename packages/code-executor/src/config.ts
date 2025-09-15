import { Schema } from "koishi";

// import { JavaScriptConfig, JavaScriptConfigSchema } from "./executors/javascript";
import { PythonConfig, PythonConfigSchema } from "./executors/python";

export interface SharedConfig {
    dependenciesPath: string;
    // artifactsPath: string;
    // artifactsUrlBase: string;
    maxOutputSize: number;
}

export interface Config {
    shared: SharedConfig;
    engines: {
        // javascript: JavaScriptConfig;
        python: PythonConfig;
    };
}

export const SharedConfig: Schema<SharedConfig> = Schema.object({
    dependenciesPath: Schema.path({ filters: ["directory"], allowCreate: true })
        .default("data/code-executor/deps")
        .description("JS/Python等引擎动态安装依赖的存放路径"),
    // artifactsPath: Schema.path({ filters: ["directory"], allowCreate: true })
    //     .default("data/code-executor/artifacts")
    //     .description("执行结果（如图片、文件）的存放路径"),
    // artifactsUrlBase: Schema.string().description("产物文件的公开访问URL前缀例如: https://my.domain/artifacts"),
    maxOutputSize: Schema.number().default(10240).description("输出内容（stdout/stderr）的最大字符数，超出部分将被截断"),
});

// 组合成总配置
export const Config = Schema.object({
    shared: SharedConfig.description("全局共享配置"),
    engines: Schema.object({
        // javascript: JavaScriptConfigSchema,
        python: PythonConfigSchema,
    }).description("执行引擎配置"),
});
