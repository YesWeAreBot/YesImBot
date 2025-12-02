import type { Logger } from "koishi";
import type { FileManager } from "./FileManager";
import type { GitHubAPI } from "./GitHubAPI";
import type { SystemUtils } from "./SystemUtils";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// 二进制安装器类
export class BinaryInstaller {
    private logger: Logger;
    private systemUtils: SystemUtils;
    private fileManager: FileManager;
    private githubAPI: GitHubAPI;
    private dataDir: string;
    private cacheDir: string;

    constructor(
        logger: Logger,
        systemUtils: SystemUtils,
        fileManager: FileManager,
        githubAPI: GitHubAPI,
        dataDir: string,
        cacheDir: string,
    ) {
        this.logger = logger;
        this.systemUtils = systemUtils;
        this.fileManager = fileManager;
        this.githubAPI = githubAPI;
        this.dataDir = dataDir;
        this.cacheDir = cacheDir;
    }

    /**
     * 安装 UV
     */
    async installUV(version: string, githubMirror?: string): Promise<string | null> {
        this.logger.info(`开始安装 UV (版本: ${version})`);

        const platformMap = this.systemUtils.getPlatformMapping();
        if (!platformMap)
            return null;

        // 解析版本号
        let targetVersion = version;
        if (version === "latest") {
            targetVersion = await this.githubAPI.getLatestVersion("astral-sh", "uv");
            if (!targetVersion) {
                this.logger.error("无法获取 UV 最新版本");
                return null;
            }
        }

        const execName = process.platform === "win32" ? "uv.exe" : "uv";
        const binDir = path.join(this.dataDir, "mcp-ext", "bin");
        const finalPath = path.join(binDir, execName);

        // 检查是否已安装正确版本
        if (await this.checkExistingVersion(finalPath, targetVersion)) {
            return finalPath;
        }

        // 下载并安装
        const filename = `uv-${platformMap.uvArch}-${platformMap.uvPlatform}.zip`;
        const downloadUrl = this.githubAPI.buildDownloadUrl("astral-sh", "uv", targetVersion, filename, githubMirror);

        const tempZip = path.join(this.cacheDir, `uv-${targetVersion}.zip`);
        const tempDir = path.join(this.cacheDir, `uv-extract-${targetVersion}`);

        try {
            await this.fileManager.downloadFile(downloadUrl, tempZip, `UV ${targetVersion}`);
            await this.fileManager.extractZip(tempZip, tempDir);

            // 查找并复制可执行文件
            const extractedPath = path.join(tempDir, execName);
            await fs.mkdir(binDir, { recursive: true });
            await fs.copyFile(extractedPath, finalPath);
            await this.systemUtils.makeExecutable(finalPath);

            this.logger.success(`UV ${targetVersion} 安装成功: ${finalPath}`);
            return finalPath;
        } catch (error: any) {
            this.logger.error(`UV 安装失败: ${error.message}`);
            return null;
        } finally {
            await this.fileManager.cleanup([tempZip, tempDir]);
        }
    }

    /**
     * 安装 Bun
     */
    async installBun(version: string, githubMirror?: string): Promise<string | null> {
        this.logger.info(`开始安装 Bun (版本: ${version})`);

        const platformMap = this.systemUtils.getPlatformMapping();
        if (!platformMap)
            return null;

        // 解析版本号
        let targetVersion = version;
        if (version === "latest") {
            targetVersion = await this.githubAPI.getLatestVersion("oven-sh", "bun");
            if (!targetVersion) {
                this.logger.error("无法获取 Bun 最新版本");
                return null;
            }
        }

        const execName = process.platform === "win32" ? "bun.exe" : "bun";
        const binDir = path.join(this.dataDir, "mcp-ext", "bin");
        const finalPath = path.join(binDir, execName);

        // 检查是否已安装正确版本
        if (await this.checkExistingVersion(finalPath, targetVersion.replace("bun-v", ""))) {
            return finalPath;
        }

        // 下载并安装
        const filename = `bun-${platformMap.bunPlatform}-${platformMap.bunArch}.zip`;
        const downloadUrl = this.githubAPI.buildDownloadUrl("oven-sh", "bun", targetVersion, filename, githubMirror);

        const tempZip = path.join(this.cacheDir, `bun-${targetVersion}.zip`);
        const tempDir = path.join(this.cacheDir, `bun-extract-${targetVersion}`);

        try {
            await this.fileManager.downloadFile(downloadUrl, tempZip, `Bun ${targetVersion}`);
            await this.fileManager.extractZip(tempZip, tempDir);

            // 查找并复制可执行文件
            const extractedPath = path.join(tempDir, `bun-${platformMap.bunPlatform}-${platformMap.bunArch}`, execName);
            await fs.mkdir(binDir, { recursive: true });
            await fs.copyFile(extractedPath, finalPath);
            await this.systemUtils.makeExecutable(finalPath);

            this.logger.success(`Bun ${targetVersion} 安装成功: ${finalPath}`);
            return finalPath;
        } catch (error: any) {
            this.logger.error(`Bun 安装失败: ${error.message}`);
            return null;
        } finally {
            await this.fileManager.cleanup([tempZip, tempDir]);
        }
    }

    /**
     * 检查已存在的版本
     */
    private async checkExistingVersion(execPath: string, targetVersion: string): Promise<boolean> {
        try {
            await fs.access(execPath);
            const currentVersion = this.systemUtils.getVersion(execPath);
            const cleanTargetVersion = targetVersion.replace(/^v/, "");

            if (currentVersion === cleanTargetVersion) {
                this.logger.info(`已安装正确版本 (${cleanTargetVersion})，跳过安装`);
                return true;
            } else {
                this.logger.info(`版本不匹配 (当前: ${currentVersion}, 目标: ${cleanTargetVersion})，将重新安装`);
            }
        } catch {
            this.logger.debug("未找到已安装的版本");
        }
        return false;
    }
}
