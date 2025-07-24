import { createHash } from "crypto";
import { Context, Logger, Service, Session } from "koishi";
import { fetch } from "undici";
import { v4 as uuidv4 } from "uuid";
import { Services, TableName } from "../types";
import { AssetServiceConfig } from "./config";
import { StorageDriverFactory } from "./drivers";
import { AssetCreateOptions, AssetData, AssetInfo, AssetType, StorageDriver } from "./types";

// 确保 Context 和 Tables 接口被正确扩展
declare module "koishi" {
    interface Context {
        [Services.Asset]: AssetService;
    }
    interface Tables {
        [TableName.Assets]: AssetData;
    }
}

export class AssetService extends Service<AssetServiceConfig> {
    static readonly inject = [Services.Logger];
    private _logger: Logger;
    private storageDriver: StorageDriver;

    constructor(ctx: Context, config: AssetServiceConfig) {
        super(ctx, Services.Asset, true);
        this.config = config;
        this._logger = ctx[Services.Logger].getLogger("[资源中心]");
    }

    protected async start() {
        // 初始化存储驱动
        this.storageDriver = StorageDriverFactory.create(this.ctx, this.config.driver, {
            path: this.config.storagePath
        });

        this._logger.debug(`存储驱动已初始化: ${this.config.driver}`);

        // 注册数据库模型
        this.ctx.model.extend(
            TableName.Assets,
            {
                id: "string(36)", // UUID
                type: "string(32)", // 资源类型
                mime: "string(128)", // MIME类型
                hash: "string(64)", // SHA256哈希
                size: "unsigned", // 文件大小
                url: "text", // 原始URL
                filename: "text", // 原始文件名
                createdAt: "timestamp", // 创建时间
                lastUsedAt: "timestamp", // 最后使用时间
                source: "json", // 来源信息
            },
            {
                primary: "id",
                unique: [["hash"]] // 哈希值唯一，用于去重
            }
        );

        // 设置自动清理任务
        if (this.config.autoClearEnabled) {
            this._logger.info("自动清理功能已启用");
            this.ctx.setInterval(
                () => this.runAutoClear(),
                this.config.autoClearIntervalHours * 60 * 60 * 1000
            );
            // 机器人启动时也执行一次清理，延迟5秒执行
            this.ctx.setTimeout(() => this.runAutoClear(), 5 * 1000);
        }

        // 注册HTTP端点用于公开访问
        if (this.config.endpoint) {
            this.registerHttpEndpoint();
        }

        // 注册管理命令
        this.registerCommands();

        this._logger.info("资源中心服务已启动");
    }

    /**
     * 创建一个资源
     * @param source URL、本地文件路径或二进制Buffer
     * @param options 创建选项
     * @returns 资源的内部ID
     */
    public async create(source: string | Buffer, options: AssetCreateOptions = {}): Promise<string> {
        let buffer: Buffer;
        let originalUrl: string | undefined;
        let filename: string | undefined = options.filename;

        // 根据source类型获取资源内容
        if (typeof source === 'string') {
            if (source.startsWith('file://')) {
                // 本地文件路径
                const fs = await import('fs/promises');
                const path = source.slice(7); // 移除 'file://' 前缀
                buffer = await fs.readFile(path);
                if (!filename) {
                    filename = path.split('/').pop() || path.split('\\').pop();
                }
            } else {
                // URL
                originalUrl = source;
                const response = await this.downloadFromUrl(source);
                buffer = response.buffer;
                if (!filename && response.filename) {
                    filename = response.filename;
                }
            }
        } else {
            // Buffer
            buffer = source;
        }

        // 检查文件大小
        if (buffer.length > this.config.maxFileSize) {
            throw new Error(`File size ${buffer.length} exceeds maximum allowed size ${this.config.maxFileSize}`);
        }

        // 计算文件哈希
        const hash = this.calculateHash(buffer);

        // 检查是否已存在相同哈希的资源
        const [existing] = await this.ctx.database.get(TableName.Assets, { hash });
        if (existing) {
            // 更新最后使用时间
            await this.ctx.database.set(TableName.Assets, { id: existing.id }, {
                lastUsedAt: new Date()
            });
            this._logger.debug(`资源已存在，返回现有ID: ${existing.id}`);
            return existing.id;
        }

        // 生成新的资源ID
        const id = uuidv4();

        // 检测MIME类型和资源类型
        const { mime, type } = this.detectMimeType(buffer, filename);

        // 检查MIME类型是否支持
        if (!this.config.supportedMimeTypes.includes(mime)) {
            throw new Error(`Unsupported MIME type: ${mime}`);
        }

        // 保存到存储系统
        await this.storageDriver.write(id, buffer);

        // 创建数据库记录
        const assetData: AssetData = {
            id,
            type,
            mime,
            hash,
            size: buffer.length,
            url: originalUrl,
            filename,
            createdAt: new Date(),
            lastUsedAt: new Date(),
            source: options.session ? {
                platform: options.session.platform,
                guildId: options.session.guildId,
                channelId: options.session.channelId,
                userId: options.session.userId,
                messageId: options.session.messageId,
            } : undefined,
        };

        await this.ctx.database.create(TableName.Assets, assetData);

        this._logger.info(`新资源已创建: ${id} (${type}, ${mime}, ${buffer.length} bytes)`);
        return id;
    }

    /**
     * 获取资源的二进制内容
     * @param id 资源ID
     * @returns 资源的二进制内容
     */
    public async get(id: string): Promise<Buffer> {
        // 检查资源是否存在
        const [assetData] = await this.ctx.database.get(TableName.Assets, { id });
        if (!assetData) {
            throw new Error(`Asset not found: ${id}`);
        }

        try {
            // 从存储系统读取
            const buffer = await this.storageDriver.read(id);

            // 更新最后使用时间
            await this.ctx.database.set(TableName.Assets, { id }, {
                lastUsedAt: new Date()
            });

            this._logger.debug(`资源已读取: ${id} (${buffer.length} bytes)`);
            return buffer;
        } catch (error) {
            this._logger.error(`读取资源失败: ${id} - ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取资源的元信息
     * @param id 资源ID
     * @returns 资源元信息
     */
    public async getInfo(id: string): Promise<AssetInfo> {
        const [assetData] = await this.ctx.database.get(TableName.Assets, { id });
        if (!assetData) {
            throw new Error(`Asset not found: ${id}`);
        }

        // 更新最后使用时间
        await this.ctx.database.set(TableName.Assets, { id }, {
            lastUsedAt: new Date()
        });

        return {
            id: assetData.id,
            type: assetData.type,
            mime: assetData.mime,
            size: assetData.size,
            filename: assetData.filename,
            createdAt: assetData.createdAt,
            lastUsedAt: new Date(),
        };
    }

    /**
     * 获取可供外部访问的临时URL
     * @param id 资源ID
     * @returns 可公开访问的URL
     */
    public async getURL(id: string): Promise<string> {
        // 检查资源是否存在
        const [assetData] = await this.ctx.database.get(TableName.Assets, { id });
        if (!assetData) {
            throw new Error(`Asset not found: ${id}`);
        }

        // 更新最后使用时间
        await this.ctx.database.set(TableName.Assets, { id }, {
            lastUsedAt: new Date()
        });

        if (this.config.endpoint) {
            // 返回公开访问端点
            return `${this.config.endpoint}/${id}`;
        } else {
            // 如果没有配置端点，返回base64编码的data URL
            const buffer = await this.storageDriver.read(id);
            return `data:${assetData.mime};base64,${buffer.toString('base64')}`;
        }
    }

    /**
     * 执行自动清理任务
     */
    public async runAutoClear(): Promise<void> {
        this._logger.info("正在执行自动清理任务...");
        const count = await this.clearExpiredAssets(this.config.maxAssetAgeDays);
        if (count > 0) {
            this._logger.info(`自动清理完成，共移除 ${count} 个过期资源`);
        } else {
            this._logger.info("自动清理完成，没有需要清理的资源");
        }
    }

    /**
     * 清理超过指定天数未使用的资源
     * @param ageInDays 天数
     * @returns 成功删除的资源数量
     */
    private async clearExpiredAssets(ageInDays: number): Promise<number> {
        const cutoff = new Date(Date.now() - ageInDays * 24 * 60 * 60 * 1000);
        const assetsToDelete = await this.ctx.database.get(TableName.Assets, {
            lastUsedAt: { $lt: cutoff },
        });

        if (assetsToDelete.length === 0) {
            return 0;
        }

        const idsToDelete = assetsToDelete.map((asset) => asset.id);
        this._logger.info(`准备清理 ${assetsToDelete.length} 个超过 ${ageInDays} 天未使用的资源`);

        // 删除物理文件
        const deletePromises = assetsToDelete.map((asset) =>
            this.storageDriver.delete(asset.id).catch((err) => {
                this._logger.warn(`删除资源文件失败: ${asset.id} | 错误: ${err.message}`);
            })
        );

        await Promise.all(deletePromises);

        // 删除数据库记录
        await this.ctx.database.remove(TableName.Assets, { id: { $in: idsToDelete } });

        return assetsToDelete.length;
    }

    /**
     * 从URL下载资源
     */
    private async downloadFromUrl(url: string): Promise<{ buffer: Buffer; filename?: string }> {
        try {
            const response = await fetch(url, { redirect: "follow" });
            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
            }

            const buffer = Buffer.from(await response.arrayBuffer());

            // 尝试从Content-Disposition头获取文件名
            let filename: string | undefined;
            const contentDisposition = response.headers.get("content-disposition");
            if (contentDisposition) {
                const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                if (match && match[1]) {
                    filename = match[1].replace(/['"]/g, '');
                }
            }

            // 如果没有从头获取到文件名，尝试从URL获取
            if (!filename) {
                const urlPath = new URL(url).pathname;
                const segments = urlPath.split('/');
                filename = segments[segments.length - 1] || undefined;
            }

            this._logger.debug(`资源已下载: ${url} (${buffer.length} bytes)`);
            return { buffer, filename };
        } catch (error) {
            this._logger.error(`下载资源失败: ${url} - ${error.message}`);
            throw error;
        }
    }

    /**
     * 计算文件内容的SHA256哈希
     */
    private calculateHash(buffer: Buffer): string {
        return createHash('sha256').update(buffer).digest('hex');
    }

    /**
     * 检测MIME类型和资源类型
     */
    private detectMimeType(buffer: Buffer, filename?: string): { mime: string; type: string } {
        // 简单的MIME类型检测，基于文件头和扩展名
        const ext = filename ? filename.split('.').pop()?.toLowerCase() : '';

        // 检查文件头
        if (buffer.length >= 4) {
            const header = buffer.subarray(0, 4);

            // PNG
            if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
                return { mime: 'image/png', type: AssetType.Image };
            }

            // JPEG
            if (header[0] === 0xFF && header[1] === 0xD8) {
                return { mime: 'image/jpeg', type: AssetType.Image };
            }

            // GIF
            if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) {
                return { mime: 'image/gif', type: AssetType.Image };
            }

            // PDF
            if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
                return { mime: 'application/pdf', type: AssetType.File };
            }
        }

        // 基于扩展名的检测
        switch (ext) {
            case 'jpg':
            case 'jpeg':
                return { mime: 'image/jpeg', type: AssetType.Image };
            case 'png':
                return { mime: 'image/png', type: AssetType.Image };
            case 'gif':
                return { mime: 'image/gif', type: AssetType.Image };
            case 'webp':
                return { mime: 'image/webp', type: AssetType.Image };
            case 'svg':
                return { mime: 'image/svg+xml', type: AssetType.Image };
            case 'mp3':
                return { mime: 'audio/mpeg', type: AssetType.Audio };
            case 'wav':
                return { mime: 'audio/wav', type: AssetType.Audio };
            case 'ogg':
                return { mime: 'audio/ogg', type: AssetType.Audio };
            case 'mp4':
                return { mime: 'video/mp4', type: AssetType.Video };
            case 'avi':
                return { mime: 'video/x-msvideo', type: AssetType.Video };
            case 'mov':
                return { mime: 'video/quicktime', type: AssetType.Video };
            case 'pdf':
                return { mime: 'application/pdf', type: AssetType.File };
            case 'txt':
                return { mime: 'text/plain', type: AssetType.File };
            case 'md':
                return { mime: 'text/markdown', type: AssetType.File };
            case 'json':
                return { mime: 'application/json', type: AssetType.File };
            case 'zip':
                return { mime: 'application/zip', type: AssetType.File };
            default:
                return { mime: 'application/octet-stream', type: AssetType.File };
        }
    }

    /**
     * 注册HTTP端点用于公开访问资源
     */
    private registerHttpEndpoint(): void {
        if (!this.ctx.server) {
            this._logger.warn("HTTP服务器未启用，无法注册资源访问端点");
            return;
        }

        this.ctx.server.get('/assets/:id', async (ctx) => {
            const { id } = ctx.params;

            try {
                // 获取资源信息
                const assetInfo = await this.getInfo(id);

                // 获取资源内容
                const buffer = await this.storageDriver.read(id);

                // 设置响应头
                ctx.set('Content-Type', assetInfo.mime);
                ctx.set('Content-Length', buffer.length.toString());

                if (assetInfo.filename) {
                    ctx.set('Content-Disposition', `inline; filename="${assetInfo.filename}"`);
                }

                // 设置缓存头
                ctx.set('Cache-Control', 'public, max-age=3600');

                ctx.body = buffer;
            } catch (error) {
                this._logger.error(`访问资源失败: ${id} - ${error.message}`);
                ctx.status = 404;
                ctx.body = { error: 'Asset not found' };
            }
        });

        this._logger.info("HTTP资源访问端点已注册: /assets/:id");
    }

    /**
     * 注册管理命令
     */
    private registerCommands(): void {
        // 手动清理命令
        this.ctx
            .command("asset.clear", "手动清理资源缓存", { authority: 3 })
            .option("age", `-a <age:number> 指定过期天数`, { fallback: this.config.maxAssetAgeDays })
            .action(async ({ options }) => {
                const count = await this.clearExpiredAssets(options.age);
                return count > 0
                    ? `清理完成！共删除了 ${count} 个超过 ${options.age} 天未使用的资源`
                    : `没有找到符合条件的资源可供清理`;
            });

        // 资源统计命令
        this.ctx
            .command("asset.stats", "查看资源统计信息", { authority: 3 })
            .action(async () => {
                const totalAssets = await this.ctx.database.get(TableName.Assets, {});
                const totalSize = totalAssets.reduce((sum, asset) => sum + asset.size, 0);

                const typeStats = totalAssets.reduce((stats, asset) => {
                    stats[asset.type] = (stats[asset.type] || 0) + 1;
                    return stats;
                }, {} as Record<string, number>);

                const statsText = Object.entries(typeStats)
                    .map(([type, count]) => `${type}: ${count}`)
                    .join(', ');

                return [
                    `资源统计信息:`,
                    `总数量: ${totalAssets.length}`,
                    `总大小: ${this.formatFileSize(totalSize)}`,
                    `类型分布: ${statsText}`,
                    `存储路径: ${this.config.storagePath}`
                ].join('\n');
            });

        // 资源信息查询命令
        this.ctx
            .command("asset.info <id>", "查看指定资源的详细信息", { authority: 3 })
            .action(async (_, id) => {
                try {
                    const info = await this.getInfo(id);
                    return [
                        `资源信息:`,
                        `ID: ${info.id}`,
                        `类型: ${info.type}`,
                        `MIME: ${info.mime}`,
                        `大小: ${this.formatFileSize(info.size)}`,
                        `文件名: ${info.filename || '未知'}`,
                        `创建时间: ${info.createdAt.toLocaleString()}`,
                        `最后使用: ${info.lastUsedAt.toLocaleString()}`
                    ].join('\n');
                } catch (error) {
                    return `获取资源信息失败: ${error.message}`;
                }
            });
    }

    /**
     * 格式化文件大小
     */
    private formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 B';

        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}