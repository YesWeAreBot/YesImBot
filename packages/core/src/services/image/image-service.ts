import { createHash } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { Context, Element, h, Logger, Service, Session } from "koishi";
import path from "path";
import sharp from "sharp";
import { fetch } from "undici";

import { truncate } from "@/shared/utils";
import { Services, TableName } from "@/services/types";
import { ImageServiceConfig } from "./config";

// 数据库中存储的图片元数据模型
export interface ImageData {
    id: string; // 原始图片的 MD5 哈希
    mimeType: string; // 处理后图片的 MimeType (固定为 'image/jpeg')
    localPath: string; // 处理后图片在本地的存储路径
    originalUrl: string; // 图片的原始下载 URL
    size: number; // 处理后文件大小 (bytes)
    width: number; // 处理后图片的宽度
    height: number; // 处理后图片的高度
    createdAt: Date;
    lastUsedAt: Date;
    source: {
        platform: string;
        guildId?: string;
        channelId: string;
        userId: string;
        messageId: string;
    }; // 原始消息来源信息
}

// 确保 Context 和 Tables 接口被正确扩展
declare module "koishi" {
    interface Context {
        [Services.Image]: ImageService;
    }
    interface Tables {
        [TableName.Images]: ImageData;
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
                id: "string(32)", // 原始图片的 MD5 hash
                mimeType: "string(32)",
                localPath: "string(255)",
                originalUrl: "string(1023)",
                size: "unsigned",
                width: "unsigned",
                height: "unsigned",
                createdAt: "timestamp",
                lastUsedAt: "timestamp",
                source: "json",
            },
            { primary: "id" }
        );

        // 设置自动清理任务
        if (this.config.autoClearEnabled) {
            this._logger.info("自动清理功能已启用");
            this.ctx.setInterval(() => this.runAutoClear(), this.config.autoClearIntervalHours * 60 * 60 * 1000);
            // 机器人启动时也执行一次清理，以防长时间离线
            this.ctx.setTimeout(() => this.runAutoClear(), 5 * 1000); // 延迟5秒执行
        }

        this._logger.info("服务已启动");

        // 手动清理命令保持不变，但现在使用配置中的默认值
        this.ctx
            .command("image.clear", "手动清理图片缓存", { authority: 3 })
            .option("age", `-a <age:number> 指定过期天数`, { fallback: this.config.maxImageAgeDays })
            .action(async ({ options }) => {
                const count = await this._clearExpiredImages(options.age);
                return count > 0
                    ? `清理完成！共删除了 ${count} 张超过 ${options.age} 天未使用的图片`
                    : `没有找到符合条件的图片可供清理`;
            });
    }

    /**
     * 执行自动清理任务
     */
    public async runAutoClear() {
        this._logger.info("正在执行自动清理任务...");
        const count = await this._clearExpiredImages(this.config.maxImageAgeDays);
        if (count > 0) {
            this._logger.info(`自动清理完成，共移除 ${count} 张过期图片`);
        } else {
            this._logger.info("自动清理完成，没有需要清理的图片");
        }
    }

    /**
     * 处理图片元素：下载、哈希原始图片、为AI优化、存储优化后版本，并返回占位符
     * @param element 图片元素
     * @param session 当前会话，用于记录来源信息
     * @returns 成功则返回占位符元素，失败则返回错误提示元素
     */
    public async processImageElement(element: Element, session: Session): Promise<Element> {
        const url = element.attrs.src;
        if (!url) {
            this._logger.warn("⚠ 跳过 | 图片元素缺少 'src' 属性");
            return null;
        }

        this._logger.debug(`🖼️ 开始处理新图片 | URL: ${truncate(url, 100)}`);

        try {
            const { buffer: originalBuffer } = await this._downloadImage(url);
            const md5 = this._calculateMD5(originalBuffer);

            const [existing] = await this.ctx.database.get(TableName.Images, { id: md5 });
            if (!existing) {
                this._logger.debug(`❌ 缓存未命中 | ID: ${md5}`);
                /* prettier-ignore */
                const { data: processedBuffer, info: processedInfo } = await this._preprocessImageForAI(originalBuffer);

                const localPath = path.join(this.config.storagePath, `${md5}.jpeg`);
                await writeFile(localPath, processedBuffer);

                const imageData: ImageData = {
                    id: md5,
                    mimeType: "image/jpeg",
                    localPath,
                    originalUrl: url,
                    size: processedBuffer.length,
                    width: processedInfo.width,
                    height: processedInfo.height,
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
                this._logger.info(`✔ 新图片已保存 | ID: ${md5} | 尺寸: ${processedInfo.width}x${processedInfo.height}`);
            } else {
                this._logger.debug(`✔ 缓存命中 | ID: ${md5}`);
                await this.ctx.database.set(TableName.Images, { id: md5 }, { lastUsedAt: new Date() });
            }
            return h("image", { id: md5, summary: element.attrs.summary || "图片" });
        } catch (error) {
            this._logger.error(`💥 处理失败 | URL: ${url} | 错误: ${error.message}`);
            return h.text(`[图片加载失败: ${truncate(url, 50)}]`);
        }
    }

    /**
     * 根据图片ID获取其元数据和 Base64 编码的内容
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
            await this.ctx.database.set(TableName.Images, { id }, { lastUsedAt: new Date() });
            return { data: imageData, content: base64Content };
        } catch (error) {
            this._logger.error(`💥 文件读取失败 | ID: ${id} | 路径: ${imageData.localPath}`);
            if (error.code === "ENOENT") {
                await this.ctx.database.remove(TableName.Images, { id });
                this._logger.warn(`🧹 移除了数据库中引用已丢失文件的记录 | ID: ${id}`);
            }
            return null;
        }
    }

    /**
     * 清理超过指定天数未使用的图片
     * @param ageInDays 天数
     * @returns 成功删除的图片数量
     */
    private async _clearExpiredImages(ageInDays: number): Promise<number> {
        const cutoff = new Date(Date.now() - ageInDays * 24 * 60 * 60 * 1000);
        const imagesToDelete = await this.ctx.database.get(TableName.Images, {
            lastUsedAt: { $lt: cutoff },
        });

        if (imagesToDelete.length === 0) {
            return 0;
        }

        const idsToDelete = imagesToDelete.map((img) => img.id);
        this._logger.info(`准备清理 ${imagesToDelete.length} 张超过 ${ageInDays} 天未使用的图片`);

        const deletePromises = imagesToDelete.map((img) =>
            unlink(img.localPath).catch((err) => {
                if (err.code !== "ENOENT") {
                    this._logger.warn(`删除文件失败: ${img.localPath} | 错误: ${err.message}`);
                }
            })
        );
        await Promise.all(deletePromises);

        const { matched } = await this.ctx.database.remove(TableName.Images, { id: { $in: idsToDelete } });
        return matched;
    }

    private async _preprocessImageForAI(inputBuffer: Buffer): Promise<{ data: Buffer; info: sharp.OutputInfo }> {
        const image = sharp(inputBuffer);
        const metadata = await image.metadata();

        const MAX_LONG_SIDE = 2048;
        const MIN_SHORT_SIDE = 768;
        let { width, height } = metadata;

        if (width > MAX_LONG_SIDE || height > MAX_LONG_SIDE) {
            image.resize({
                width: MAX_LONG_SIDE,
                height: MAX_LONG_SIDE,
                fit: "inside",
                withoutEnlargement: true,
            });
            // After resize, metadata needs to be re-evaluated
            const tempBuffer = await image.toBuffer();
            const newMetadata = await sharp(tempBuffer).metadata();
            width = newMetadata.width;
            height = newMetadata.height;
        }

        const shortSide = Math.min(width, height);
        if (shortSide < MIN_SHORT_SIDE) {
            const scale = MIN_SHORT_SIDE / shortSide;
            const newWidth = Math.round(width * scale);
            const newHeight = Math.round(height * scale);

            if (Math.max(newWidth, newHeight) > MAX_LONG_SIDE) {
                image.resize({ width: MAX_LONG_SIDE, height: MAX_LONG_SIDE, fit: "inside" });
            } else {
                image.resize(newWidth, newHeight);
            }
        }

        return image.toFormat("jpeg").jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
    }

    private async _downloadImage(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
        const response = await fetch(url, { redirect: "follow" });
        if (!response.ok) {
            throw new Error(`HTTP 错误 | 状态: ${response.status} ${response.statusText}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        const mimeType = response.headers.get("content-type") || "application/octet-stream";
        return { buffer, mimeType };
    }

    private _calculateMD5(buffer: Buffer): string {
        return createHash("md5").update(buffer).digest("hex");
    }
}
