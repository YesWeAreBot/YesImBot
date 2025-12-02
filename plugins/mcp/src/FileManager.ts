import type { Logger } from "koishi";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import Stream from "node:stream";
import * as yauzl from "yauzl";

// 文件下载和解压工具类
export class FileManager {
    private logger: Logger;
    private http: any;

    constructor(logger: Logger, http: any) {
        this.logger = logger;
        this.http = http;
    }

    /**
     * 下载文件
     */
    async downloadFile(url: string, destPath: string, description: string): Promise<void> {
        this.logger.info(`正在下载 ${description}...`);
        this.logger.debug(`下载地址: ${url}`);

        try {
            const response = await this.http.get(url, { responseType: "stream" });
            await fs.mkdir(path.dirname(destPath), { recursive: true });

            const writer = createWriteStream(destPath);
            await Stream.promises.pipeline(response, writer);

            this.logger.success(`${description} 下载完成`);
        } catch (error: any) {
            this.logger.error(`下载失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 使用 yauzl 库解压 zip 文件。
     * @param {string} zipPath zip 文件路径。
     * @param {string} destDir 目标目录。
     * @returns {Promise<void>}
     */
    async extractZip(zipPath: string, destDir: string): Promise<void> {
        this.logger.info(`正在解压文件 "${zipPath}" 到 "${destDir}"...`);
        await fs.mkdir(destDir, { recursive: true });
        return new Promise((resolve, reject) => {
            yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
                if (err) {
                    this.logger.error(`打开 zip 文件失败: ${err.message}`);
                    return reject(err);
                }
                zipfile.readEntry();
                zipfile.on("entry", (entry) => {
                    const entryPath = path.resolve(destDir, entry.fileName);

                    // 安全检查：防止路径遍历攻击
                    if (!entryPath.startsWith(destDir)) {
                        this.logger.warn(`跳过不安全的路径: ${entry.fileName}`);
                        zipfile.readEntry();
                        return;
                    }
                    if (/\/$/.test(entry.fileName)) {
                        // 目录条目
                        fs.mkdir(entryPath, { recursive: true })
                            .then(() => {
                                zipfile.readEntry();
                            })
                            .catch(reject);
                    } else {
                        // 文件条目
                        zipfile.openReadStream(entry, (err, readStream) => {
                            if (err) {
                                return reject(err);
                            }
                            // 确保父目录存在
                            fs.mkdir(path.dirname(entryPath), { recursive: true })
                                .then(() => {
                                    const writeStream = createWriteStream(entryPath);
                                    readStream.pipe(writeStream);
                                    writeStream.on("close", () => {
                                        zipfile.readEntry();
                                    });
                                    writeStream.on("error", reject);
                                })
                                .catch(reject);
                        });
                    }
                });
                zipfile.on("end", () => {
                    this.logger.info(`文件 "${zipPath}" 解压成功。`);
                    resolve();
                });
                zipfile.on("error", (err) => {
                    this.logger.error(`解压文件 "${zipPath}" 失败: ${err.message}`);
                    reject(err);
                });
            });
        });
    }

    /**
     * 清理临时文件
     */
    async cleanup(paths: string[]): Promise<void> {
        for (const filePath of paths) {
            try {
                await fs.rm(filePath, { recursive: true, force: true });
                this.logger.debug(`清理: ${filePath}`);
            } catch (error: any) {
                this.logger.debug(`清理失败: ${filePath} - ${error.message}`);
            }
        }
    }
}
