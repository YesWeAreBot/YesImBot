import { Services, TableName } from "@/shared/constants";
import { formatSize, truncate } from "@/shared/utils";
import { createHash } from "crypto";
import { fromBuffer } from "file-type";
import { promises as fs } from "fs";
import { Context, Element, Service, h } from "koishi";
import sharp from "sharp";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { AssetServiceConfig } from "./config";
import { LocalStorageDriver } from "./drivers/local";
import { AssetData, AssetInfo, AssetMetadata, ReadAssetOptions, StorageDriver } from "./types";

const ELEMENT_TO_PROCESS = ["img", "image", "audio", "video", "file", "mface"];

/**
 * 根据 MIME 类型获取对应的 Koishi 元素标签名
 * @param mime - MIME 类型字符串
 * @returns 元素标签名 ('img', 'audio', 'video', 'file')
 */
function getTagNameFromMime(mime: string): string {
    if (!mime) return "file";
    const mainType = mime.split("/")[0];
    switch (mainType) {
        case "image":
            return "img";
        case "audio":
            return "audio";
        case "video":
            return "video";
        default:
            return "file";
    }
}

declare module "koishi" {
    interface Context {
        [Services.Asset]: AssetService;
    }
    interface Tables {
        [TableName.Assets]: AssetData;
    }
}

/**
 * 资源管理服务 (AssetService)
 * 负责资源的持久化存储、去重、读取、处理和生命周期管理
 */
export class AssetService extends Service<AssetServiceConfig> {
    static readonly inject = ["database", "server", "http", Services.Logger];

    // 缓存和常量
    private static readonly PROCESSED_IMAGE_CACHE_SUFFIX = ".p.jpeg";
    private static readonly MAX_COMPRESSION_ATTEMPTS = 5; // 压缩图片时的最大尝试次数

    private storage: StorageDriver;
    private cacheStorage: StorageDriver;

    constructor(ctx: Context, config: AssetServiceConfig) {
        super(ctx, Services.Asset, true);
        this.config = config;
        this.config.maxFileSize *= 1024 * 1024; // 转换为字节
        this.logger = ctx[Services.Logger].getLogger("[资源服务]");
    }

    protected async start() {
        this.logger.info("资源服务正在启动...");

        // 初始化存储驱动
        this.storage = new LocalStorageDriver(this.ctx, this.config.storagePath);
        this.cacheStorage = new LocalStorageDriver(this.ctx, this.config.image.processedCachePath);

        // 扩展数据库表
        this.ctx.model.extend(
            TableName.Assets,
            {
                id: "string(36)",
                mime: "string(128)",
                hash: "string(64)",
                size: "unsigned",
                createdAt: "timestamp",
                lastUsedAt: "timestamp",
                metadata: "json",
            },
            { primary: "id", unique: ["hash"] }
        );

        // 设置自动清理任务
        if (this.config.autoClear.enabled) {
            const interval = this.config.autoClear.intervalHours * 3600 * 1000;
            this.ctx.setInterval(() => this.runAutoClear(), interval);
            this.logger.info(
                `已启用资源自动清理，周期: ${this.config.autoClear.intervalHours} 小时，保留天数: ${this.config.autoClear.maxAgeDays}`
            );
        }

        // 注册 HTTP 访问端点
        if (this.config.endpoint) {
            this.registerHttpEndpoint();
        }

        this.logger.success("资源服务已启动。");
    }

    /**
     * 同步转换消息内容，将外部资源链接持久化并替换为内部ID
     * 此方法会等待所有资源持久化完成
     * @param source - 原始消息字符串或元素数组
     * @returns 转换后的消息字符串
     */
    async transform(source: string | Element[]): Promise<string> {
        const elements = typeof source === "string" ? h.parse(source) : source;
        const transformedElements = await h.transformAsync(elements, (el) => this._processTransformElement(el, false));
        // return h.render(transformedElements);
        return transformedElements.join("");
    }

    /**
     * 异步转换消息内容，立即返回带占位符ID的消息，并在后台进行资源持久化
     * 适用于不要求立即使用资源的场景，可以提高响应速度
     * @param source - 原始消息字符串或元素数组
     * @returns 转换后的消息字符串
     */
    async transformAsync(source: string | Element[]): Promise<string> {
        const elements = typeof source === "string" ? h.parse(source) : source;
        const transformedElements = await h.transformAsync(elements, (el) => this._processTransformElement(el, true));
        // return h.render(transformedElements);
        return transformedElements.join("");
    }

    /**
     * 创建一个新资源。
     * @param source - 资源的来源 (Buffer, data:, file:, http(s): URL)
     * @param metadata - 资源的元数据
     * @param options - 内部选项，如预设的ID
     * @returns 资源的唯一 ID
     */
    async create(source: string | Buffer, metadata: AssetMetadata = {}, options: { id?: string } = {}): Promise<string> {
        const buffer = await this._getSourceBuffer(source);
        if (!buffer || buffer.length === 0) throw new Error("资源内容为空");

        const hash = createHash("sha256").update(buffer).digest("hex");
        const [existing] = await this.ctx.database.get(TableName.Assets, { hash });

        if (existing) {
            //this.logger.debug(`资源哈希命中 (源: ${truncate(String(source), 50)})，复用ID: ${existing.id}`);
            await this._updateLastUsed(existing.id);
            return existing.id;
        }

        const fileType = await fromBuffer(buffer);
        const mime = fileType?.mime || "application/octet-stream";

        // 如果是图片，尝试获取尺寸信息
        if (mime.startsWith("image/")) {
            try {
                const imageMeta = await sharp(buffer).metadata();
                metadata.width = imageMeta.width;
                metadata.height = imageMeta.height;
            } catch (e) {
                this.logger.warn(`无法解析图片元数据: ${e.message}`);
            }
        }

        const id = options.id || uuidv4();
        await this.storage.write(id, buffer);

        const assetData: AssetData = {
            id,
            mime,
            hash,
            size: buffer.length,
            createdAt: new Date(),
            lastUsedAt: new Date(),
            metadata,
        };

        await this.ctx.database.upsert(TableName.Assets, [assetData]);
        this.logger.info(`新资源已存储 | ID: ${id} | 类型: ${mime} | 大小: ${formatSize(buffer.length)}`);
        return id;
    }

    /**
     * 根据ID读取资源
     * 支持按需进行图片处理和缓存
     * @param id - 资源 ID
     * @param options - 读取选项，可控制是否处理图片和返回格式
     * @returns 资源内容，格式由 options.format 决定
     */
    async read(id: string, options: ReadAssetOptions = {}): Promise<Buffer | string> {
        const asset = await this._getAssetWithUpdate(id);
        if (!asset) throw new Error(`数据库中找不到资源: ${id}`);

        let finalBuffer: Buffer;
        const shouldProcess = options.image?.process && asset.mime.startsWith("image/");
        const cacheId = id + AssetService.PROCESSED_IMAGE_CACHE_SUFFIX;

        if (shouldProcess && (await this.cacheStorage.exists(cacheId))) {
            this.logger.debug(`命中处理后图片缓存: ${cacheId}`);
            finalBuffer = await this.cacheStorage.read(cacheId);
        } else {
            const originalBuffer = await this._readOriginalWithRecovery(id, asset);
            if (shouldProcess) {
                this.logger.debug(`无缓存，开始实时处理图片: ${id}`);
                finalBuffer = await this._processImage(originalBuffer, asset.mime);
                await this.cacheStorage.write(cacheId, finalBuffer);
                this.logger.debug(`处理结果已缓存: ${cacheId}`);
            } else {
                finalBuffer = originalBuffer;
            }
        }

        const { format = "buffer" } = options;
        switch (format) {
            case "base64":
                return finalBuffer.toString("base64");
            case "data-url":
                // 处理后的图片统一为 webp 或 jpeg，需要确定MIME
                const outputMime = shouldProcess ? "image/jpeg" : asset.mime;
                return `data:${outputMime};base64,${finalBuffer.toString("base64")}`;
            default:
                return finalBuffer;
        }
    }

    /**
     * 根据 ID 获取资源的元信息
     * @param id - 资源 ID
     * @returns 资源的元信息，若不存在则返回 null
     */
    async getInfo(id: string): Promise<AssetInfo | null> {
        const asset = await this._getAssetWithUpdate(id);
        if (!asset) return null;
        const { hash, ...info } = asset; // 移除不应公开的 hash 字段
        return info;
    }

    /**
     * 获取资源的公开访问链接
     * @param id - 资源 ID
     * @returns 资源的公开链接，若未配置 endpoint 则回退到 data URL
     */
    async getPublicUrl(id: string): Promise<string> {
        if (!this.config.endpoint) {
            this.logger.warn(`未配置公开访问端点，为资源 ${id} 回退到 Base64 Data URL。`);
            return (await this.read(id, { format: "data-url" })) as string;
        }

        await this._updateLastUsed(id); // 确保访问时更新使用时间
        const endpoint = this.config.endpoint.endsWith("/") ? this.config.endpoint : `${this.config.endpoint}/`;
        return `${endpoint}${id}`;
    }

    /**
     * 将包含内部资源ID的消息元素编码为平台可发送的URL或元素
     * @param source - 消息字符串或元素数组
     * @returns 编码后的元素数组
     */
    async encode(source: string | Element[]): Promise<Element[]> {
        const elements = typeof source === "string" ? h.parse(source) : source;
        return h.transformAsync(elements, async (element) => {
            if (!element.attrs.id) return element;
            if (!ELEMENT_TO_PROCESS.includes(element.type)) return element;

            const info = await this.getInfo(element.attrs.id);
            if (!info) {
                this.logger.warn(`编码时找不到资源: ${element.attrs.id}，将返回原始元素。`);
                return element;
            }

            try {
                // 使用 getPublicUrl 确保逻辑统一
                const src = await this.getPublicUrl(element.attrs.id);
                const tagName = getTagNameFromMime(info.mime);
                const { id, ...restAttrs } = element.attrs;
                return h(tagName, { ...restAttrs, src });
            } catch (error) {
                this.logger.error(`获取资源 "${element.attrs.id}" 的公开链接失败: ${error.message}`);
                return element;
            }
        });
    }

    // --- 私有方法 ---

    /**
     * 处理 transform/transformAsync 中的单个元素
     */
    private async _processTransformElement(element: Element, isAsync: boolean): Promise<Element> {
        if (!ELEMENT_TO_PROCESS.includes(element.type)) return element;
        const originalUrl = element.attrs.src || element.attrs.url || element.attrs.file;
        const filename = element.attrs.filename || element.attrs.name || element.attrs.fileName;
        if (!originalUrl || element.attrs.id) return element;

        // 根据元素类型和URL协议决定是否处理
        let tagName = element.type;

        if (tagName === "mface") {
            tagName = "img";
        }

        if (tagName === "file" && !String(originalUrl).startsWith("http")) {
            return element; // 只处理网络文件资源
        }

        const metadata: AssetMetadata = {
            filename,
            src: originalUrl,
            summary: element.attrs.summary,
        };

        const { src, ...displayAttrs } = metadata;

        if (tagName === "img") {
            delete displayAttrs["filename"];
        }

        if (isAsync) {
            const placeholderId = uuidv4();
            // 立即返回带占位符ID的元素，后台执行持久化
            (async () => {
                try {
                    await this.create(originalUrl, metadata, { id: placeholderId });
                } catch (error) {
                    this.logger.error(`后台资源持久化失败 (ID: ${placeholderId}, 源: ${truncate(originalUrl, 100)}): ${error.message}`);
                    // 可在此处添加失败处理逻辑，如更新数据库标记此ID无效
                }
            })();
            return h(tagName, { ...displayAttrs, id: placeholderId });
        } else {
            try {
                const id = await this.create(originalUrl, metadata);
                return h(tagName, { ...displayAttrs, id });
            } catch (error) {
                this.logger.error(`资源持久化失败 (源: ${truncate(originalUrl, 100)}): ${error.message}`);
                return element; // 失败时返回原始元素
            }
        }
    }

    private async _getSourceBuffer(source: string | Buffer): Promise<Buffer> {
        if (Buffer.isBuffer(source)) return source;
        if (source.startsWith("data:")) {
            const match = source.match(/^data:.+;base64,(.*)$/);
            if (!match) throw new Error("无效的 data: URL 格式");
            return Buffer.from(match[1], "base64");
        }
        if (source.startsWith("file://")) return fs.readFile(fileURLToPath(source));
        if (source.startsWith("http")) {
            return this._downloadResource(source);
        }
        throw new Error(`不支持的资源来源: "${truncate(source, 50)}"`);
    }

    private async _downloadResource(url: string): Promise<Buffer> {
        // 1. 预检文件大小
        try {
            const head = await this.ctx.http.head(url, { timeout: this.config.downloadTimeout / 2 });
            const contentLength = head.get("content-length");
            if (contentLength && Number(contentLength) > this.config.maxFileSize) {
                throw new Error(`文件大小 (${formatSize(Number(contentLength))}) 超出限制 (${formatSize(this.config.maxFileSize)})`);
            }
        } catch (error) {
            // 如果预检失败（如服务器不支持HEAD），下载时仍会受限于 maxBodySize。
            if (error.message.includes("超出限制")) throw error;
            //this.logger.warn(`无法预检文件大小 (URL: ${url}): ${error.message}，将继续尝试下载。`);
        }

        // 2. 下载文件
        const response = await this.ctx.http.get(url, {
            responseType: "arraybuffer",
            timeout: this.config.downloadTimeout,
            // maxBodySize: this.config.maxFileSize,
        });
        return Buffer.from(response);
    }

    private async _readOriginalWithRecovery(id: string, asset: AssetData): Promise<Buffer> {
        try {
            return await this.storage.read(id);
        } catch (error) {
            // 如果文件在本地丢失，且开启了恢复功能，且有原始链接，则尝试恢复
            if (error.code === "ENOENT" && this.config.recoveryEnabled && asset.metadata.src) {
                this.logger.warn(`本地文件 ${id} 丢失，尝试从 ${asset.metadata.src} 恢复...`);
                try {
                    const buffer = await this._getSourceBuffer(asset.metadata.src);
                    await this.storage.write(id, buffer); // 恢复文件
                    this.logger.success(`资源 ${id} 已成功恢复。`);
                    return buffer;
                } catch (recoveryError) {
                    this.logger.error(`资源 ${id} 恢复失败: ${recoveryError.message}`);
                    throw recoveryError; // 抛出恢复失败的错误
                }
            }
            throw error; // 抛出原始的读取错误
        }
    }

    private async _processImage(buffer: Buffer, mime: string): Promise<Buffer> {
        if (mime === "image/gif") {
            if (this.config.image.gifProcessingStrategy === "stitch") {
                return this._processGifStitch(buffer);
            }
            if (this.config.image.gifProcessingStrategy === "firstFrame") {
                // 处理GIF第一帧
                const firstFrameBuffer = await sharp(buffer, { page: 0 }).toBuffer();
                return this._compressAndResizeImage(firstFrameBuffer);
            }
            // `gifProcessingStrategy` 为 'none' 或其他值，不处理
            return buffer;
        }

        return this._compressAndResizeImage(buffer);
    }

    private async _compressAndResizeImage(buffer: Buffer): Promise<Buffer> {
        const sharpInstance = sharp(buffer);
        const meta = await sharpInstance.metadata();
        const { targetSize } = this.config.image;

        // 调整尺寸
        if (meta.width > targetSize || meta.height > targetSize) {
            sharpInstance.resize({ width: targetSize, height: targetSize, fit: "inside", withoutEnlargement: true });
        }

        // 动态调整质量进行压缩
        const maxSizeBytes = this.config.image.maxSizeMB * 1024 * 1024;
        let quality = 90;
        let compressedBuffer: Buffer;

        for (let i = 0; i < AssetService.MAX_COMPRESSION_ATTEMPTS; i++) {
            compressedBuffer = await sharpInstance.jpeg({ quality, progressive: true, mozjpeg: true }).toBuffer();
            if (compressedBuffer.length <= maxSizeBytes) {
                this.logger.debug(`图片压缩成功，质量: ${quality}, 大小: ${formatSize(compressedBuffer.length)}`);
                return compressedBuffer;
            }
            quality -= 10;
            this.logger.debug(`压缩后大小为 ${formatSize(compressedBuffer.length)}，超出限制，降低质量至 ${quality} 重试...`);
        }

        this.logger.warn(`无法将图片压缩到 ${this.config.image.maxSizeMB}MB 以下，将使用最后一次压缩结果。`);
        return compressedBuffer;
    }

    /**
     * 处理GIF动图，提取关键帧并拼接成静态图
     * @param buffer
     * @returns
     */
    private async _processGifStitch(buffer: Buffer): Promise<Buffer> {
        const { gifFramesToExtract } = this.config.image;
        const meta = await sharp(buffer, { animated: true }).metadata();
        const pageCount = meta.pages || 1;

        // 计算要抽取的帧的索引
        const frameIndices = Array.from({ length: Math.min(gifFramesToExtract, pageCount) }, (_, i) =>
            Math.floor(i * (pageCount / Math.min(gifFramesToExtract, pageCount)))
        );

        const frames = await Promise.all(frameIndices.map((index) => sharp(buffer, { page: index }).resize({ width: 384 }).toBuffer()));
        const frameMetas = await Promise.all(frames.map((f) => sharp(f).metadata()));

        // 计算拼接后画布的尺寸
        const cols = Math.ceil(Math.sqrt(frames.length));
        const maxFrameHeight = Math.max(...frameMetas.map((m) => m.height));
        const finalWidth = cols * 384;
        const finalHeight = Math.ceil(frames.length / cols) * maxFrameHeight;

        const compositeOps = frames.map((frame, i) => ({
            input: frame,
            top: Math.floor(i / cols) * maxFrameHeight,
            left: (i % cols) * 384,
        }));

        // 创建透明背景并拼接图片
        return sharp({ create: { width: finalWidth, height: finalHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .composite(compositeOps)
            .jpeg({ quality: 85 })
            .toBuffer();
    }

    private async _getAssetWithUpdate(id: string): Promise<AssetData | null> {
        const [asset] = await this.ctx.database.get(TableName.Assets, { id });
        if (!asset) return null;
        await this._updateLastUsed(id);
        return asset;
    }

    private async _updateLastUsed(id: string): Promise<void> {
        await this.ctx.database.set(TableName.Assets, { id }, { lastUsedAt: new Date() });
    }

    private registerHttpEndpoint() {
        const routePath = this.config.endpoint.startsWith("/") ? this.config.endpoint : new URL(this.config.endpoint).pathname;
        const finalRoute = `${routePath.replace(/\/$/, "")}/:id`; // 确保路径格式正确

        this.ctx.server.get(finalRoute, async (ctx) => {
            const { id } = ctx.params;
            try {
                // getInfo 内部会更新 lastUsedAt，但这里我们主要获取元数据
                const info = await this.getInfo(id);
                if (!info) throw new Error("Asset not found in database");

                const buffer = await this.storage.read(id);
                ctx.status = 200;
                ctx.set("Content-Type", info.mime);
                ctx.set("Content-Length", info.size.toString());
                ctx.set("Cache-Control", "public, max-age=31536000, immutable"); // 长期缓存
                ctx.body = buffer;
            } catch (err) {
                // 如果是文件找不到，返回404，否则可能为其他服务器错误，但为简单起见统一返回404
                this.logger.warn(`通过 HTTP 端点提供资源 ${id} 失败: ${err.message}`);
                ctx.status = 404;
                ctx.body = "Asset not found";
            }
        });
        this.logger.info(`HTTP 服务端点已注册: GET ${finalRoute}`);
    }

    private async runAutoClear() {
        this.logger.info("开始执行过期资源自动清理任务...");
        const cutoffDate = new Date(Date.now() - this.config.autoClear.maxAgeDays * 24 * 3600 * 1000);
        const expiredAssets = await this.ctx.database.get(TableName.Assets, { lastUsedAt: { $lt: cutoffDate } });

        if (!expiredAssets.length) {
            this.logger.info("没有需要清理的过期资源。");
            return;
        }

        this.logger.info(`发现 ${expiredAssets.length} 个待清理的过期资源...`);
        let deletedFileCount = 0;
        for (const asset of expiredAssets) {
            try {
                await this.storage.delete(asset.id);
                // 同时删除可能存在的处理后缓存
                await this.cacheStorage.delete(asset.id + AssetService.PROCESSED_IMAGE_CACHE_SUFFIX).catch(() => {});
                deletedFileCount++;
            } catch (error) {
                if (error.code !== "ENOENT") {
                    // 如果文件本就不存在，则忽略错误
                    this.logger.error(`删除物理文件 ${asset.id} 失败: ${error.message}`);
                }
            }
        }
        this.logger.info(`已成功清理 ${deletedFileCount} 个资源的物理文件。`);

        const idsToDelete = expiredAssets.map((a) => a.id);
        const { removed } = await this.ctx.database.remove(TableName.Assets, { id: { $in: idsToDelete } });
        this.logger.success(`成功从数据库中清理了 ${removed} 条资源记录。任务完成。`);
    }
}
