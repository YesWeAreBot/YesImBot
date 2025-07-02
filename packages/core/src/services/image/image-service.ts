import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { Context, Element, Service, Session } from "koishi";
import path from "path";
import { fetch } from "undici";
import { Services, TableName } from "../types";
import { ImageServiceConfig } from "./config";
import { ImageData } from "./database-models";

const LOG_PREFIX = "[ImageService]";

declare module "koishi" {
    interface Context {
        [Services.Image]: ImageService;
    }
}

export class ImageService extends Service<ImageServiceConfig> {
    constructor(ctx: Context, config: ImageServiceConfig) {
        super(ctx, Services.Image, true);
        this.ctx = ctx;
        this.config = config;

        this.ctx.logger.name = LOG_PREFIX;
    }

    protected async start() {
        this.logger.info("Starting ImageService...");
        // 确保存储目录存在
        await mkdir(this.config.storagePath, { recursive: true });

        // 注册数据库模型
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
            {
                primary: "id",
            }
        );
        this.logger.info("ImageService started and database model registered.");
    }

    /**
     * 处理一个图片元素：下载、哈希、存储，并返回占位符。
     * @param element 图片元素
     * @param session 当前会话，用于记录来源信息
     * @returns 成功则返回占位符字符串，失败则返回 null
     */
    public async processImageElement(element: Element, session: Session): Promise<string | null> {
        const url = element.attrs.src;
        if (!url) {
            this.logger.warn("Image element is missing 'src' attribute.");
            return null;
        }

        try {
            const { buffer, mimeType } = await this._downloadImage(url);
            const md5 = this._calculateMD5(buffer);
            const extension = this._getExtensionFromMimeType(mimeType);
            const localPath = path.join(this.config.storagePath, `${md5}.${extension}`);

            // 检查图片是否已存在
            const existing = await this.ctx.database.get(TableName.Images, { id: md5 });
            if (existing.length === 0) {
                // 不存在则写入文件并创建数据库记录
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
                this.logger.info(`New image saved: ${md5} from ${url}`);
            } else {
                this.logger.debug(`Image already exists in cache: ${md5}`);
            }

            return `<image id="${md5}"/>`;
        } catch (error) {
            this.logger.error(`Failed to process image from URL: ${url}`, error);
            return `[图片加载失败: ${url}]`;
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
            this.logger.warn(`Could not find image metadata for ID: ${id}`);
            return null;
        }

        try {
            const buffer = await readFile(imageData.localPath);
            const base64Content = `data:${imageData.mimeType};base64,${buffer.toString("base64")}`;
            return { data: imageData, content: base64Content };
        } catch (error) {
            this.logger.error(`Failed to read image file for ID ${id} at path ${imageData.localPath}`, error);
            return null;
        }
    }

    private async _downloadImage(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for URL: ${url}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        const mimeType = response.headers.get("content-type") || "application/octet-stream";
        return { buffer, mimeType };
    }

    private _calculateMD5(buffer: Buffer): string {
        return createHash("md5").update(buffer).digest("hex");
    }

    private _getExtensionFromMimeType(mimeType: string): string {
        const parts = mimeType.split("/");
        return parts[1] || "bin";
    }
}
