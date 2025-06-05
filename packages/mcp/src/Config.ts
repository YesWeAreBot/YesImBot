import { Schema } from "koishi";

// 配置接口
export interface Server {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    /**
     * 是否启用命令转换，将 uvx 转换为 uv tool run，npx 转换为 bun x
     */
    enableCommandTransform?: boolean;
}

// 平台架构映射配置
export interface PlatformMapping {
    platform: string;
    arch: string;
    uvPlatform: string;
    uvArch: string;
    bunPlatform: string;
    bunArch: string;
}

export interface Config {
    timeout: number;
    mcpServers: Record<string, Server>;
    uvSettings?: {
        autoDownload?: boolean;
        uvVersion?: string; // 具体版本号，如 "0.1.25"
        pypiMirror: string;
        githubMirror?: string; // GitHub 镜像地址
        args?: string[];
    };
    bunSettings?: {
        autoDownload?: boolean;
        bunVersion?: string; // 具体版本号，如 "1.0.0"
        githubMirror?: string; // GitHub 镜像地址
        args?: string[];
    };
    globalSettings?: {
        enableCommandTransform?: boolean; // 全局命令转换开关
    };
}

// 配置模式定义
export const Config: Schema<Config> = Schema.object({
    timeout: Schema.number().description("⏱️ 请求超时时间（毫秒）").default(5000),
    mcpServers: Schema.dict(
        Schema.object({
            url: Schema.string().description("🌐 MCP 服务器地址 (HTTP/SSE)"),
            command: Schema.string().description("⚡ MCP 服务器启动命令"),
            args: Schema.array(Schema.string()).role("table").description("📋 启动参数列表"),
            env: Schema.dict(String).role("table").description("🔧 环境变量设置"),
            enableCommandTransform: Schema.boolean().description("🔄 启用命令转换 (uvx → uv tool run, npx → bun x)").default(true),
        }).collapse()
    ).description("📡 MCP 服务器配置列表"),
    uvSettings: Schema.object({
        autoDownload: Schema.boolean().description("📥 自动下载并安装 UV").default(true),
        uvVersion: Schema.string().description("🏷️ UV 版本号 (如: 0.1.25, latest)").default("latest"),
        pypiMirror: Schema.string().description("🐍 PyPI 镜像源地址").default("https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple"),
        githubMirror: Schema.string().description("🪞 GitHub 镜像地址 (可选，如: https://mirror.ghproxy.com)").default(""),
        args: Schema.array(Schema.string()).role("table").description("⚙️ UV 启动附加参数").default([]),
    }).description("🚀 UV (Ultraviolet) 配置"),
    bunSettings: Schema.object({
        autoDownload: Schema.boolean().description("📥 自动下载并安装 Bun").default(true),
        bunVersion: Schema.string().description("🏷️ Bun 版本号 (如: 1.0.0, latest)").default("latest"),
        githubMirror: Schema.string().description("🪞 GitHub 镜像地址 (可选，如: https://mirror.ghproxy.com)").default(""),
        args: Schema.array(Schema.string()).role("table").description("⚙️ Bun 启动附加参数").default([]),
    }).description("🥖 Bun 运行时配置"),
    globalSettings: Schema.object({
        enableCommandTransform: Schema.boolean().description("🌍 全局启用命令转换").default(true),
    }).description("🌐 全局设置"),
});
