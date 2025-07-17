import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
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
                description: "text",
                source: "json",
            },
            { primary: "id" }
        );
        this._logger.info("服务已启动");
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

        this._logger.info(`🖼️ 开始处理新图片 | URL: ${truncate(url)}`);

        try {
            const { buffer, mimeType } = await this._downloadImage(url);
            const md5 = this._calculateMD5(buffer);
            const extension = this._getExtensionFromMimeType(mimeType);
            const localPath = path.join(this.config.storagePath, `${md5}.${extension}`);

            const existing = await this.ctx.database.get(TableName.Images, { id: md5 });
            if (existing.length === 0) {
                this._logger.debug(`❌ 缓存未命中 | ID: ${md5}`);
                await writeFile(localPath, buffer);

                const imageData: ImageData = {
                    id: md5,
                    mimeType,
                    localPath,
                    originalUrl: url,
                    size: buffer.length,
                    createdAt: new Date(),
                    source: {
                        platform: session.platform,
                        guildId: session.guildId,
                        channelId: session.channelId,
                        userId: session.userId,
                        messageId: session.messageId,
                    },
                };
                await this.ctx.database.create(TableName.Images, imageData);
                this._logger.info(`✔ 新图片已保存 | ID: ${md5}`);
            } else {
                this._logger.debug(`✔ 缓存命中 | ID: ${md5}`);
            }

            return h("image", { id: md5 });
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
            this._logger.debug(`✔ 成功获取图片内容 | ID: ${id}`);
            return { data: imageData, content: base64Content };
        } catch (error) {
            this._logger.error(`💥 文件读取失败 | ID: ${id} | 路径: ${imageData.localPath}`, error);
            return null;
        }
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
        // 简单的从 'image/jpeg' 中提取 'jpeg'
        const parts = mimeType.split("/");
        return parts[1] || "bin";
    }
}
