import { createWriteStream } from "fs";
import fs from "fs/promises";
import { createHash } from "node:crypto";
import path from "path";
import Stream from "stream";

import { x as extractTar } from "tar";
import * as yauzl from "yauzl";

import { Logger } from "./Logger";

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
    async downloadFile(url: string, destPath: string, description: string, sha256?: string): Promise<void> {
        this.logger.info(`正在下载 ${description}...`);
        this.logger.debug(`下载地址: ${url}`);

        try {
            const response = await this.http.get(url, { responseType: "stream", timeout: 60000 });
            await fs.mkdir(path.dirname(destPath), { recursive: true });

            const writer = createWriteStream(destPath);
            let size = 0;
            const digest = createHash("sha256");
            const limiter = new Stream.Transform({
                transform(chunk, _encoding, callback) {
                    size += chunk.length;
                    if (size > 128 * 1024 * 1024) return callback(new Error("Runtime archive exceeds 128 MiB"));
                    digest.update(chunk);
                    callback(null, chunk);
                },
            });
            const signal = AbortSignal.timeout(60000);
            await Stream.promises.pipeline(response, limiter, writer, { signal });
            const actual = digest.digest("hex");
            if (sha256 && actual !== sha256.toLowerCase()) throw new Error("Runtime SHA-256 mismatch");

            this.logger.success(`${description} 下载完成`);
        } catch (error) {
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
                let entries = 0;
                let expandedBytes = 0;
                zipfile.readEntry();
                zipfile.on("entry", (entry) => {
                    entries++;
                    expandedBytes += entry.uncompressedSize;
                    if (entries > 1024 || expandedBytes > 256 * 1024 * 1024 || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) {
                        zipfile.close();
                        reject(new Error("Unsafe or oversized runtime archive"));
                        return;
                    }
                    const entryPath = path.resolve(destDir, entry.fileName);

                    // 安全检查：防止路径遍历攻击
                    if (!entryPath.startsWith(path.resolve(destDir) + path.sep)) {
                        this.logger.warn(`跳过不安全的路径: ${entry.fileName}`);
                        zipfile.readEntry();
                        return;
                    }
                    if (entry.fileName.endsWith("/")) {
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
                                    readStream.on("error", reject);
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
    async extractTarGz(archive: string, destDir: string): Promise<void> {
        await fs.mkdir(destDir, { recursive: true });
        let entries = 0;
        let expandedBytes = 0;
        await extractTar({
            file: archive,
            cwd: destDir,
            strict: true,
            preservePaths: false,
            filter(name, entry) {
                entries++;
                expandedBytes += entry.size ?? 0;
                if (
                    entries > 1024 ||
                    expandedBytes > 256 * 1024 * 1024 ||
                    path.isAbsolute(name) ||
                    name.split("/").includes("..") ||
                    !("type" in entry) ||
                    !["File", "Directory"].includes(entry.type)
                )
                    throw new Error("Unsafe or oversized runtime archive");
                return true;
            },
        });
    }

    async cleanup(paths: string[]): Promise<void> {
        for (const filePath of paths) {
            try {
                await fs.rm(filePath, { recursive: true, force: true });
                this.logger.debug(`清理: ${filePath}`);
            } catch (error) {
                this.logger.debug(`清理失败: ${filePath} - ${error.message}`);
            }
        }
    }
}
