import type { Logger } from "koishi";
import type { Config } from "./Config";
import type { SystemUtils } from "./SystemUtils";
import process from "node:process";

// 命令解析器类
export class CommandResolver {
    private logger: Logger;
    private systemUtils: SystemUtils;
    private installedUVPath: string | null;
    private installedBunPath: string | null;
    private config: Config;

    constructor(
        logger: Logger,
        systemUtils: SystemUtils,
        config: Config,
        installedUVPath: string | null = null,
        installedBunPath: string | null = null,
    ) {
        this.logger = logger;
        this.systemUtils = systemUtils;
        this.config = config;
        this.installedUVPath = installedUVPath;
        this.installedBunPath = installedBunPath;
    }

    /**
     * 解析最终的启动命令和参数
     */
    async resolveCommand(
        command: string,
        args: string[],
        enableTransform: boolean = true,
        additionalEnv: Record<string, string> = {},
    ): Promise<[string, string[], Record<string, string>]> {
        let finalCommand = command;
        let finalArgs = [...args];
        const finalEnv = { ...process.env, ...additionalEnv };

        // 设置 UV/Python 环境变量
        this.setupUVEnvironment(finalEnv);

        // 处理命令转换
        if (enableTransform) {
            const transformed = this.transformCommand(finalCommand, finalArgs);
            finalCommand = transformed.command;
            finalArgs = transformed.args;
        }

        this.logger.debug(`最终命令: ${finalCommand} ${finalArgs.join(" ")}`);
        return [finalCommand, finalArgs, finalEnv];
    }

    /**
     * 转换命令 (uvx → uv tool run, npx → bun x)
     */
    private transformCommand(command: string, args: string[]): { command: string; args: string[] } {
        // 处理 uvx 命令
        if (command === "uvx") {
            if (this.installedUVPath) {
                this.logger.info("转换: uvx → uv tool run");
                return {
                    command: this.installedUVPath,
                    args: ["tool", "run", ...args],
                };
            } else if (this.systemUtils.checkCommand("uv")) {
                this.logger.info("转换: uvx → uv tool run (系统版本)");
                return {
                    command: "uv",
                    args: ["tool", "run", ...args],
                };
            } else {
                this.logger.warn("uvx 转换失败：未找到 uv");
                return { command, args };
            }
        }

        // 处理 npx 命令
        if (command === "npx") {
            if (this.installedBunPath) {
                this.logger.info("转换: npx → bun x");
                return {
                    command: this.installedBunPath,
                    args: ["x", ...args],
                };
            } else if (this.systemUtils.checkCommand("bun")) {
                this.logger.info("转换: npx → bun x (系统版本)");
                return {
                    command: "bun",
                    args: ["x", ...args],
                };
            } else {
                this.logger.warn("npx 转换失败：未找到 bun");
                return { command, args };
            }
        }

        // 处理 uv 命令
        if (command === "uv" && this.installedUVPath) {
            return {
                command: this.installedUVPath,
                args: [...(this.config.uvSettings?.args || []), ...args],
            };
        }

        // 处理 bun 命令
        if (command === "bun" && this.installedBunPath) {
            return {
                command: this.installedBunPath,
                args: [...(this.config.bunSettings?.args || []), ...args],
            };
        }

        return { command, args };
    }

    /**
     * 设置 UV/Python 相关环境变量
     */
    private setupUVEnvironment(env: Record<string, string>): void {
        if (this.config.uvSettings?.pypiMirror) {
            const mirror = this.config.uvSettings.pypiMirror;
            env.PIP_INDEX_URL = mirror;
            env.UV_INDEX_URL = mirror;
            this.logger.debug(`设置 PyPI 镜像: ${mirror}`);
        }
    }

    /**
     * 更新已安装的二进制路径
     */
    updateInstalledPaths(uvPath: string | null, bunPath: string | null): void {
        this.installedUVPath = uvPath;
        this.installedBunPath = bunPath;
    }
}
