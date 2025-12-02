import type { Context } from "koishi";
import type { Config } from "./Config";
import fs from "node:fs/promises";
import path from "node:path";

import { Services } from "koishi-plugin-yesimbot/shared";
import { BinaryInstaller } from "./BinaryInstaller";
import { CommandResolver } from "./CommandResolver";
import { FileManager } from "./FileManager";
import { GitHubAPI } from "./GitHubAPI";
import { MCPManager } from "./MCPManager";
import { SystemUtils } from "./SystemUtils";

export const name = "yesimbot-extension-mcp";

export const inject = {
    required: ["http", Services.Plugin],
};

export { Config } from "./Config";

// 主应用入口
export async function apply(ctx: Context, config: Config) {
    const logger = ctx.logger("mcp");
    const systemUtils = new SystemUtils(logger);
    const fileManager = new FileManager(logger, ctx.http);
    const githubAPI = new GitHubAPI(logger, ctx.http);

    const dataDir = path.resolve(ctx.baseDir, "data");
    const cacheDir = path.resolve(ctx.baseDir, "cache", "mcp-ext-temp");

    const binaryInstaller = new BinaryInstaller(logger, systemUtils, fileManager, githubAPI, dataDir, cacheDir);

    let installedUVPath: string | null = null;
    let installedBunPath: string | null = null;

    const commandResolver = new CommandResolver(logger, systemUtils, config, installedUVPath, installedBunPath);

    const pluginService = ctx[Services.Plugin];
    const mcpManager = new MCPManager(ctx, logger, commandResolver, pluginService, config);

    // 启动时初始化
    ctx.on("ready", async () => {
        logger.info("开始初始化 MCP 扩展插件");

        try {
            // 创建必要目录
            await fs.mkdir(path.join(dataDir, "mcp-ext", "bin"), { recursive: true });
            await fs.mkdir(cacheDir, { recursive: true });
        } catch (error: any) {
            logger.error("目录创建失败");
        }

        // 安装二进制文件
        if (config.uvSettings?.autoDownload) {
            logger.info("开始安装 UV...");
            installedUVPath = await binaryInstaller.installUV(config.uvSettings.uvVersion || "latest", config.globalSettings?.githubMirror);
        }

        if (config.bunSettings?.autoDownload) {
            logger.info("开始安装 Bun...");
            installedBunPath = await binaryInstaller.installBun(
                config.bunSettings.bunVersion || "latest",
                config.globalSettings?.githubMirror,
            );
        }

        // 更新命令解析器的二进制路径
        commandResolver.updateInstalledPaths(installedUVPath, installedBunPath);

        // 连接 MCP 服务器
        await mcpManager.connectServers();

        logger.success("MCP 扩展插件初始化完成");
    });

    // 清理资源
    ctx.on("dispose", async () => {
        await mcpManager.cleanup();
        await fileManager.cleanup([cacheDir]);
        logger.success("插件清理完成");
    });
}
