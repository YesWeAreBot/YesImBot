import type { Logger } from "koishi";
import type { PlatformMapping } from "./Config";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import process from "node:process";

const PLATFORM_ARCH_MAP: PlatformMapping[] = [
    {
        platform: "darwin",
        arch: "arm64",
        uvPlatform: "apple-darwin",
        uvArch: "aarch64",
        bunPlatform: "darwin",
        bunArch: "aarch64",
    },
    {
        platform: "darwin",
        arch: "x64",
        uvPlatform: "apple-darwin",
        uvArch: "x86_64",
        bunPlatform: "darwin",
        bunArch: "x64",
    },
    {
        platform: "linux",
        arch: "arm64",
        uvPlatform: "unknown-linux-gnu",
        uvArch: "aarch64",
        bunPlatform: "linux",
        bunArch: "aarch64",
    },
    {
        platform: "linux",
        arch: "x64",
        uvPlatform: "unknown-linux-gnu",
        uvArch: "x86_64",
        bunPlatform: "linux",
        bunArch: "x64",
    },
    {
        platform: "win32",
        arch: "x64",
        uvPlatform: "pc-windows-msvc",
        uvArch: "x86_64",
        bunPlatform: "windows",
        bunArch: "x64",
    },
];

// 系统工具类
export class SystemUtils {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * 获取当前系统平台架构映射
     */
    getPlatformMapping(): PlatformMapping | null {
        const osPlatform = process.platform;
        const osArch = process.arch;
        const mapping = PLATFORM_ARCH_MAP.find((map) => map.platform === osPlatform && map.arch === osArch);

        if (!mapping) {
            this.logger.error(`不支持的系统平台: ${osPlatform}-${osArch}`);
            return null;
        }

        this.logger.debug(`检测到系统平台: ${osPlatform}-${osArch}`);
        return mapping;
    }

    /**
     * 检查命令是否存在
     */
    checkCommand(command: string): boolean {
        try {
            const checkCmd = process.platform === "win32" ? `where ${command}` : `which ${command}`;
            execSync(checkCmd, { stdio: "ignore" });
            this.logger.debug(`命令 "${command}" 可用`);
            return true;
        } catch {
            this.logger.debug(`命令 "${command}" 不可用`);
            return false;
        }
    }

    /**
     * 获取可执行文件版本
     */
    getVersion(executablePath: string): string | null {
        try {
            const output = execSync(`"${executablePath}" --version`, {
                encoding: "utf-8",
                timeout: 5000,
            });
            const versionMatch = output.match(/\d+\.\d+\.\d+/);
            return versionMatch ? versionMatch[0] : null;
        } catch (error: any) {
            this.logger.debug(`获取版本失败: ${error.message}`);
            return null;
        }
    }

    /**
     * 设置文件可执行权限
     */
    async makeExecutable(filePath: string): Promise<void> {
        if (process.platform === "linux" || process.platform === "darwin") {
            try {
                await fs.chmod(filePath, 0o755);
                this.logger.debug(`设置可执行权限: ${filePath}`);
            } catch (error: any) {
                this.logger.warn(`设置权限失败: ${error.message}`);
            }
        }
    }
}
