// src/services/asset/drivers/local.ts

import { promises as fs } from "fs";
import { Context, Logger } from "koishi";
import { resolve } from "path";
import { StorageDriver } from "../types";

/**
 * 本地文件系统存储驱动
 */
export class LocalStorageDriver implements StorageDriver {
    private readonly logger: Logger;

    constructor(
        private readonly ctx: Context,
        public readonly baseDir: string
    ) {
        this.logger = ctx.logger("[本地存储驱动]");
        this.ensureDirectory();
    }

    private async ensureDirectory() {
        try {
            await fs.mkdir(this.baseDir, { recursive: true });
            this.logger.debug(`存储目录已确认: ${this.baseDir}`);
        } catch (error) {
            this.logger.error(`创建存储目录失败: ${error.message}`);
            throw error;
        }
    }

    public getPath(id: string): string {
        return resolve(this.baseDir, id);
    }

    async write(id: string, buffer: Buffer): Promise<void> {
        const filePath = this.getPath(id);
        try {
            await fs.writeFile(filePath, buffer);
            this.logger.debug(`资源已写入: ${id} (${buffer.length} bytes)`);
        } catch (error) {
            this.logger.error(`写入资源失败: ${id} - ${error.message}`);
            throw error;
        }
    }

    async read(id: string): Promise<Buffer> {
        const filePath = this.getPath(id);
        try {
            const buffer = await fs.readFile(filePath);
            this.logger.debug(`资源已读取: ${id} (${buffer.length} bytes)`);
            return buffer;
        } catch (error) {
            if (error.code === "ENOENT") {
                this.logger.warn(`资源文件不存在: ${id}`);
                // 抛出特定错误，由上层服务处理恢复逻辑
                error.message = `Resource file not found: ${id}`;
                throw error;
            }
            this.logger.error(`读取资源失败: ${id} - ${error.message}`);
            throw error;
        }
    }

    async delete(id: string): Promise<void> {
        const filePath = this.getPath(id);
        try {
            await fs.unlink(filePath);
            this.logger.debug(`资源已删除: ${id}`);
        } catch (error) {
            if (error.code === "ENOENT") {
                this.logger.debug(`尝试删除不存在的资源，已忽略: ${id}`);
                return;
            }
            this.logger.error(`删除资源失败: ${id} - ${error.message}`);
            throw error;
        }
    }

    async exists(id: string): Promise<boolean> {
        try {
            await fs.access(this.getPath(id));
            return true;
        } catch {
            return false;
        }
    }
}
