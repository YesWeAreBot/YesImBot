import { createHash } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { Context, Element, h, Logger, Service, Session } from "koishi";
import path from "path";
import { fetch } from "undici";

import { truncate } from "@/shared";
import { Services, TableName } from "../types";
import { ImageServiceConfig } from "./config";
import { ImageData } from "./database-models";

declare module "koishi" {
    interface Context {
        [Services.Image]: ImageService;
    }
}

export class ImageService extends Service<ImageServiceConfig> {
    static readonly inject = [Services.Logger];
    private _logger: Logger;

    constructor(ctx: Context, config: ImageServiceConfig) {
        super(ctx, Services.Image, true);
        this.config = config;
        this._logger = ctx[Services.Logger].getLogger("[图片服务]");
    }

    protected async start() {
        await mkdir(this.config.storagePath, { recursive: true });
        this._logger.debug(`存储目录已确认: ${this.config.storagePath}`);

        this.ctx.model.extend(
            TableName.Images,
            {
                id: "string(32)", // MD5 hash
                mimeType: "string(64)",
                localPath: "string(255)",
                originalUrl: "string(1023)",
                size: "unsigned",
                createdAt: "timestamp",
                lastUsedAt: "timestamp",
                description: "text",
                source: "json",
            },
            { primary: "id" }
        );
        this._logger.info("服务已启动");

        this.ctx
            .command("image.clear", "清空图片缓存", { authority: 3 })
            .option("range", "-r <range:string> 指定清理范围 (all, unused, expired)", { fallback: "unused" })
            .option("age", "-a <age:number> 指定过期天数 (默认为30天)", { fallback: 30 })
            .action(async ({ options }) => {
                const { range, age } = options;
                const cutoff = new Date(Date.now() - age * 24 * 60 * 60 * 1000);
                let imagesToDelete: ImageData[] = [];
                let message: string;

                switch (range) {
                    case "all":
                        imagesToDelete = await this.ctx.database.get(TableName.Images, {});
                        message = "所有图片缓存";
                        break;
                    case "unused":
                        // 查找在指定天数内未被使用的图片
                        imagesToDelete = await this.ctx.database.get(TableName.Images, {
                            lastUsedAt: { $lt: cutoff },
                        });
                        message = `超过 ${age} 天未使用的图片`;
                        break;
                    case "expired":
                        // 查找在指定天数前创建的图片
                        imagesToDelete = await this.ctx.database.get(TableName.Images, {
                            createdAt: { $lt: cutoff },
                        });
                        message = `超过 ${age} 天前创建的图片`;
                        break;
                    default:
                        return `不支持的清理范围 "${range}"。可用范围: all, unused, expired。`;
                }

                if (imagesToDelete.length === 0) {
                    return `没有找到符合条件的图片可供清理。`;
                }

                const count = await this._deleteImages(imagesToDelete);
                return `清理完成！共删除了 ${count} 张${message}。`;
            });
    }

    /**
     * 处理一个图片元素：下载、哈希、存储，并返回占位符。
     * @param element 图片元素
     * @param session 当前会话，用于记录来源信息
     * @returns 成功则返回占位符字符串，失败则返回 null
     */
    public async processImageElement(element: Element, session: Session): Promise<Element | null> {
        const url = element.attrs.src;
        if (!url) {
            this._logger.warn("⚠ 跳过 | 图片元素缺少 'src' 属性");
            return null;
        }

        this._logger.debug(`🖼️ 开始处理新图片 | URL: ${truncate(url)}`);

        try {
            const { buffer, mimeType } = await this._downloadImage(url);
            const md5 = this._calculateMD5(buffer);
            const extension = this._getExtensionFromMimeType(mimeType);
            const localPath = path.join(this.config.storagePath, `${md5}.${extension}`);

            const [existing] = await this.ctx.database.get(TableName.Images, { id: md5 });
            if (!existing) {
                this._logger.debug(`❌ 缓存未命中 | ID: ${md5}`);
                await writeFile(localPath, buffer);

                const imageData: ImageData = {
                    id: md5,
                    mimeType,
                    localPath,
                    originalUrl: url,
                    size: buffer.length,
                    createdAt: new Date(),
                    lastUsedAt: new Date(),
                    source: {
                        platform: session.platform,
                        guildId: session.guildId,
                        channelId: session.channelId,
                        userId: session.userId,
                        messageId: session.messageId,
                    },
                };
                await this.ctx.database.create(TableName.Images, imageData);
                this._logger.debug(`✔ 新图片已保存 | ID: ${md5}`);
            } else {
                this._logger.debug(`✔ 缓存命中 | ID: ${md5}`);
                // 缓存命中时，更新其最后使用时间
                await this.ctx.database.set(TableName.Images, { id: md5 }, { lastUsedAt: new Date() });
            }

            return h("image", { id: md5, summary: element.attrs.summary });
        } catch (error) {
            this._logger.error(`💥 处理失败 | URL: ${url} | 错误: ${error.message}`, error);
            return h.text(`[图片加载失败: ${url}]`);
        }
    }

    /**
     * 根据图片ID获取其元数据和 Base64 编码的内容。
     * @param id 图片的 MD5 哈希 ID
     * @returns 包含元数据和 Base64 字符串的对象，或在找不到时返回 null
     */
    public async getImageDataWithContent(id: string): Promise<{ data: ImageData; content: string } | null> {
        const [imageData] = await this.ctx.database.get(TableName.Images, { id });
        if (!imageData) {
            this._logger.warn(`⚠ 元数据未找到 | ID: ${id}`);
            return null;
        }

        try {
            const buffer = await readFile(imageData.localPath);
            const base64Content = `data:${imageData.mimeType};base64,${buffer.toString("base64")}`;

            // 获取图片内容意味着图片被使用了，更新 lastUsedAt
            await this.ctx.database.set(TableName.Images, { id }, { lastUsedAt: new Date() });
            this._logger.debug(`✔ 成功获取图片内容并更新使用时间 | ID: ${id}`);

            return { data: imageData, content: base64Content };
        } catch (error) {
            this._logger.error(`💥 文件读取失败 | ID: ${id} | 路径: ${imageData.localPath}`);
            // 如果文件不存在，也应该考虑从数据库中移除这条脏数据
            if (error.code === "ENOENT") {
                await this.ctx.database.remove(TableName.Images, { id });
                this._logger.warn(`🧹 移除了数据库中引用已丢失文件的记录 | ID: ${id}`);
            }
            return null;
        }
    }

    /**
     * 删除指定的图片记录及其对应的本地文件。
     * @param images 要删除的图片数据数组
     * @returns 成功删除的图片数量
     */
    private async _deleteImages(images: ImageData[]): Promise<number> {
        if (!images || images.length === 0) return 0;

        const idsToDelete = images.map((img) => img.id);
        this._logger.info(`准备清理 ${images.length} 张图片...`);

        // 并行删除本地文件
        const deletePromises = images.map((img) =>
            unlink(img.localPath).catch((err) => {
                // 如果文件已不存在，则忽略错误，否则记录错误
                if (err.code !== "ENOENT") {
                    this._logger.warn(`删除文件失败: ${img.localPath} | 错误: ${err.message}`);
                }
            })
        );
        await Promise.all(deletePromises);

        // 从数据库中批量删除记录
        const { matched } = await this.ctx.database.remove(TableName.Images, { id: { $in: idsToDelete } });

        this._logger.info(`清理完成。${matched} 条记录已从数据库中移除。`);
        return matched;
    }

    private async _downloadImage(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
        this._logger.debug(`📥 正在下载图片 | URL: ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP 错误! 状态: ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        const mimeType = response.headers.get("content-type") || "application/octet-stream";
        this._logger.debug(`✔ 下载完成 | 大小: ${(buffer.length / 1024).toFixed(2)} KB, 类型: ${mimeType}`);
        return { buffer, mimeType };
    }

    private _calculateMD5(buffer: Buffer): string {
        return createHash("md5").update(buffer).digest("hex");
    }

    private _getExtensionFromMimeType(mimeType: string): string {
        const parts = mimeType.split("/");
        // 简单处理，可以考虑使用 mime-types 等库进行更精确的映射
        return parts[1] ? parts[1].split("+")[0] : "bin"; // 'image/svg+xml' -> 'svg'
    }
}
