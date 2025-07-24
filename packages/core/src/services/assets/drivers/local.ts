import { promises as fs } from 'fs';
import { resolve } from 'path';
import { Context, Logger } from 'koishi';
import { StorageDriver } from '../types';
import { Services } from '../../types';

/**
 * 本地文件系统存储驱动
 */
export class LocalStorageDriver implements StorageDriver {
    private baseDir: string;
    private logger: Logger;

    constructor(ctx: Context, config: { path: string }) {
        // 默认存储在 Koishi 数据目录下的 assets 文件夹
        this.baseDir = resolve(ctx.baseDir, config.path || 'data/assets');
        this.logger = ctx[Services.Logger].getLogger('[本地存储驱动]');

        // 确保存储目录存在
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
        try {
            const filePath = this.getPath(id);
            await fs.writeFile(filePath, buffer);
            this.logger.debug(`资源已写入: ${id} (${buffer.length} bytes)`);
        } catch (error) {
            this.logger.error(`写入资源失败: ${id} - ${error.message}`);
            throw error;
        }
    }

    async read(id: string): Promise<Buffer> {
        try {
            const filePath = this.getPath(id);
            const buffer = await fs.readFile(filePath);
            this.logger.debug(`资源已读取: ${id} (${buffer.length} bytes)`);
            return buffer;
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.logger.warn(`资源文件不存在: ${id}`);
                throw new Error(`Resource not found: ${id}`);
            }
            this.logger.error(`读取资源失败: ${id} - ${error.message}`);
            throw error;
        }
    }

    async delete(id: string): Promise<void> {
        try {
            const filePath = this.getPath(id);
            await fs.unlink(filePath);
            this.logger.debug(`资源已删除: ${id}`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // 文件不存在，忽略错误
                this.logger.debug(`尝试删除不存在的资源: ${id}`);
                return;
            }
            this.logger.error(`删除资源失败: ${id} - ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取存储目录路径
     */
    getStoragePath(): string {
        return this.baseDir;
    }

    /**
     * 检查资源是否存在
     */
    async exists(id: string): Promise<boolean> {
        try {
            const filePath = this.getPath(id);
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 获取资源文件统计信息
     */
    async stat(id: string): Promise<{ size: number; mtime: Date }> {
        try {
            const filePath = this.getPath(id);
            const stats = await fs.stat(filePath);
            return {
                size: stats.size,
                mtime: stats.mtime
            };
        } catch (error) {
            this.logger.error(`获取资源统计信息失败: ${id} - ${error.message}`);
            throw error;
        }
    }
}
