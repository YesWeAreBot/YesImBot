import { Services, TableName } from "@/services/types";
import { createHash } from "crypto";
import { fromBuffer } from "file-type";
import { Context, Dict, Element, Service, Session, h } from "koishi";
import sharp from "sharp";
import { fetch } from "undici";
import { v4 as uuidv4 } from "uuid";
import { AssetServiceConfig } from "./config";
import { LocalStorageDriver } from "./drivers";
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
    static readonly inject = ["database", "server"];
    private storage: StorageDriver;

    constructor(ctx: Context, config: AssetServiceConfig) {
        super(ctx, Services.Asset, true);
        this.config = config;
        this.logger = ctx.logger("AssetService");
    }

    protected async start() {
        this.storage = new LocalStorageDriver(this.ctx, { path: this.config.storagePath });
        this.logger.debug(`Storage driver "local" initialized at: ${this.config.storagePath}`);

        this.ctx.model.extend(
            TableName.Assets,
            {
                id: "string(36)",
                type: "string(32)",
                mime: "string(128)",
                hash: "string(64)",
                size: "unsigned",
                createdAt: "timestamp",
                lastUsedAt: "timestamp",
                metadata: "json",
            },
            { primary: "id", unique: ["hash"] }
        );

        if (this.config.autoClearEnabled) {
            this.ctx.setInterval(() => this.runAutoClear(), this.config.autoClearIntervalHours * 3600 * 1000);
            this.logger.info(`Auto-clearing enabled for assets older than ${this.config.maxAssetAgeDays} days.`);
        }

        if (this.config.endpoint) {
            this.registerHttpEndpoint();
        }

        this.registerMiddleware();
    }

    /**
     * 注册中间件，自动将接收到的消息中的资源元素（如图片）持久化。
     */
    private registerMiddleware() {
        // 解码中间件 (Decode): 将平台消息的 `src` 转换为内部 `id`
        this.ctx.middleware(async (session, next) => {
            const handle = async (type: AssetType, attrs: Dict, tagName: string) => {
                if (!attrs.src || attrs.id) return h(tagName, attrs);
                try {
                    const id = await this.create(attrs.src, { type, filename: attrs.filename });
                    const { src, ...rest } = attrs;
                    return h(tagName, { ...rest, id });
                } catch (error) {
                    this.logger.error(`Failed to persist asset from ${attrs.src}: ${error.message}`);
                    return h.text(`[${type}加载失败]`);
                }
            };
            try {
                session.elements = await h.transformAsync(session.elements, async (element) => {
                    switch (element.type) {
                        case "img":
                        case "image":
                            return handle(AssetType.Image, element.attrs, "image");
                        case "audio":
                            return handle(AssetType.Audio, element.attrs, "audio");
                        case "video":
                            return handle(AssetType.Video, element.attrs, "video");
                        case "file":
                            return handle(AssetType.File, element.attrs, "file");
                        case "mface":
                            element.attrs.src = element.attrs.url;
                            return handle(AssetType.Image, element.attrs, "img");
                        default:
                            return element;
                    }
                });
            } catch (error) {
                this.logger.warn(`Failed to transform incoming message: ${error.message}`);
            }
            return next();
        }, true); // `true` 表示前置中间件，高优先级执行

        this.logger.info("Message transformer middleware registered.");
    }

    /**
     * 编码消息元素，将带有内部 `id` 的元素转换为平台可发送的 `src` 格式。
     * @param elements 待编码的消息元素数组
     * @returns 编码后的消息元素数组
     */
    public async encode(elements: h[]): Promise<h[]> {
        const handle = async (attrs: Dict, tagName: string) => {
            if (!attrs.id) return h(tagName, attrs);
            try {
                const src = await this.getPublicUrl(attrs.id);
                const { id, ...rest } = attrs;
                return h(tagName, { ...rest, src });
            } catch (error) {
                this.logger.error(`Failed to get public URL for asset ${attrs.id}: ${error.message}`);
                return h.text(`[资源访问失败]`);
            }
        };
        return h.transformAsync(elements, async (element) => {
            switch (element.type) {
                case "img":
                case "image":
                    return handle(element.attrs, "img");
                case "audio":
                    return handle(element.attrs, "audio");
                case "video":
                    return handle(element.attrs, "video");
                case "file":
                    return handle(element.attrs, "file");
                default:
                    return element;
            }
        });
    }

    /**
     * 创建一个资源，处理下载、查重、入库和存储，返回内部ID。
     * @param source 资源的 URL 或 Buffer
     * @param options 创建选项
     * @returns 资源的内部 ID
     */
    public async create(source: string | Buffer, options: AssetCreateOptions = {}): Promise<string> {
        let buffer: Buffer;
        let originalUrl: string | undefined;

        if (typeof source === "string") {
            originalUrl = source;
            this.logger.debug(`Downloading asset from URL: ${source}`);
            const response = await fetch(source);
            if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
            buffer = Buffer.from(await response.arrayBuffer());
        } else {
            buffer = source;
        }

        if (buffer.length > this.config.maxFileSize) {
            throw new Error(`File size (${buffer.length}) exceeds limit (${this.config.maxFileSize})`);
        }

        const hash = createHash("sha256").update(buffer).digest("hex");
        const existing = await this.ctx.database.get(TableName.Assets, { hash });

        if (existing.length > 0) {
            const assetId = existing[0].id;
            await this.ctx.database.set(TableName.Assets, { id: assetId }, { lastUsedAt: new Date() });
            this.logger.info(`Asset already exists (hash: ${hash}). Reusing ID: ${assetId}`);
            return assetId;
        }

        const typeInfo = await fromBuffer(buffer);
        const mime = typeInfo?.mime || "application/octet-stream";

        // 验证 MIME 类型是否支持
        if (!this.config.supportedMimeTypes.includes(mime)) {
            throw new Error(
                `Unsupported MIME type: ${mime}. Supported types: ${this.config.supportedMimeTypes.join(", ")}`
            );
        }

        const type = options.type || this.getTypeFromMime(mime);

        // 如果是图片且启用了图片处理，则进行处理
        let processedBuffer = buffer;
        let metadata: any = { filename: options.filename };

        if (type === AssetType.Image && this.config.imageProcessing.enabled) {
            const result = await this.processImageForAI(buffer);
            processedBuffer = result.buffer;
            metadata = {
                ...metadata,
                width: result.width,
                height: result.height,
                originalSize: buffer.length,
                processedSize: processedBuffer.length,
            };
        }

        const id = uuidv4();
        await this.storage.write(id, processedBuffer);

        const assetData: AssetData = {
            id,
            type,
            mime: type === AssetType.Image && this.config.imageProcessing.enabled ? "image/jpeg" : mime,
            hash,
            size: processedBuffer.length,
            createdAt: new Date(),
            lastUsedAt: new Date(),
            metadata,
        };

        await this.ctx.database.create(TableName.Assets, assetData);
        this.logger.info(`New asset created. ID: ${id}, Type: ${type}, Size: ${processedBuffer.length} bytes`);
        return id;
    }

    /**
     * 读取资源的二进制内容。
     * @param id 资源 ID
     * @returns 资源的 Buffer
     */
    public async read(id: string): Promise<Buffer> {
        const [asset] = await this.ctx.database.get(TableName.Assets, { id });
        if (!asset) throw new Error(`Asset with ID "${id}" not found.`);
        const buffer = await this.storage.read(id);
        await this.ctx.database.set(TableName.Assets, { id }, { lastUsedAt: new Date() });
        return buffer;
    }

    /**
     * 获取资源的元信息。
     * @param id 资源 ID
     * @returns 资源的元信息
     */
    public async getInfo(id: string): Promise<AssetInfo> {
        const [asset] = await this.ctx.database.get(TableName.Assets, { id });
        if (!asset) throw new Error(`Asset with ID "${id}" not found.`);
        await this.ctx.database.set(TableName.Assets, { id }, { lastUsedAt: new Date() });
        const { hash, ...info } = asset; // Exclude internal fields
        return info;
    }

    /**
     * 获取资源的公开访问链接。
     * 如果配置了 endpoint，则返回基于 endpoint 的 URL。
     * 否则，返回 Base64 编码的 Data URL。
     * @param id 资源 ID
     * @returns 资源的公开链接
     */
    public async getPublicUrl(id: string): Promise<string> {
        const [asset] = await this.ctx.database.get(TableName.Assets, { id });
        if (!asset) throw new Error(`Asset with ID "${id}" not found.`);

        await this.ctx.database.set(TableName.Assets, { id }, { lastUsedAt: new Date() });

        if (this.config.endpoint) {
            const endpoint = this.config.endpoint.endsWith("/") ? this.config.endpoint : `${this.config.endpoint}/`;
            return `${endpoint}${id}`;
        } else {
            this.logger.warn(
                `No public endpoint configured. Falling back to Base64 Data URL for asset ${id}. This may be inefficient for large files.`
            );
            const buffer = await this.storage.read(id);
            return `data:${asset.mime};base64,${buffer.toString("base64")}`;
        }
    }

    private getTypeFromMime(mime: string): AssetType {
        if (mime.startsWith("image/")) return AssetType.Image;
        if (mime.startsWith("audio/")) return AssetType.Audio;
        if (mime.startsWith("video/")) return AssetType.Video;
        return AssetType.File;
    }

    private registerHttpEndpoint() {
        const route = this.config.endpoint.startsWith("/")
            ? this.config.endpoint
            : new URL(this.config.endpoint).pathname;

        this.ctx.server.get(`${route}/:id`, async (ctx) => {
            const { id } = ctx.params;
            try {
                const info = await this.getInfo(id);
                const buffer = await this.storage.read(id);
                ctx.status = 200;
                ctx.set("Content-Type", info.mime);
                ctx.set("Content-Length", info.size.toString());
                ctx.set("Cache-Control", "public, max-age=31536000"); // Cache for 1 year
                ctx.body = buffer;
            } catch (err) {
                this.logger.warn(`Failed to serve asset ${id}: ${err.message}`);
                ctx.status = 404;
                ctx.body = "Asset not found";
            }
        });
        this.logger.info(`HTTP endpoint registered at GET ${route}/:id`);
    }

    private async runAutoClear() {
        this.logger.info("Running auto-clear task for expired assets...");
        const cutoff = new Date(Date.now() - this.config.maxAssetAgeDays * 24 * 3600 * 1000);
        const expiredAssets = await this.ctx.database.get(TableName.Assets, { lastUsedAt: { $lt: cutoff } });

        if (!expiredAssets.length) {
            this.logger.info("No expired assets to clear.");
            return;
        }

        this.logger.info(`Found ${expiredAssets.length} expired assets to remove.`);
        for (const asset of expiredAssets) {
            try {
                await this.storage.delete(asset.id);
            } catch (error) {
                this.logger.warn(`Failed to delete storage for asset ${asset.id}: ${error.message}`);
            }
        }

        const idsToDelete = expiredAssets.map((a) => a.id);
        const { removed } = await this.ctx.database.remove(TableName.Assets, { id: { $in: idsToDelete } });
        this.logger.info(`Successfully cleared ${removed} assets from database.`);
    }

    /**
     * 为 AI 处理图片：压缩、调整尺寸、转换格式
     * @param buffer 原始图片 Buffer
     * @returns 处理后的图片信息
     */
    private async processImageForAI(buffer: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
        const { maxLongSide, minShortSide, quality } = this.config.imageProcessing;

        let image = sharp(buffer);
        const { width, height } = await image.metadata();

        if (!width || !height) {
            throw new Error("Unable to read image dimensions");
        }

        // 调整尺寸逻辑（与 ImageService 保持一致）
        const shortSide = Math.min(width, height);
        if (shortSide < minShortSide) {
            const scale = minShortSide / shortSide;
            const newWidth = Math.round(width * scale);
            const newHeight = Math.round(height * scale);

            if (Math.max(newWidth, newHeight) > maxLongSide) {
                image = image.resize({ width: maxLongSide, height: maxLongSide, fit: "inside" });
            } else {
                image = image.resize(newWidth, newHeight);
            }
        }

        const result = await image.toFormat("jpeg").jpeg({ quality }).toBuffer({ resolveWithObject: true });

        return {
            buffer: result.data,
            width: result.info.width,
            height: result.info.height,
        };
    }

    /**
     * 获取资源的 Base64 编码内容（兼容 ImageService 接口）
     * @param id 资源 ID
     * @returns 包含资源数据和 Base64 内容的对象
     */
    public async getAssetDataWithContent(id: string): Promise<{ data: AssetData; content: string } | null> {
        const [asset] = await this.ctx.database.get(TableName.Assets, { id });
        if (!asset) {
            this.logger.warn(`Asset not found: ${id}`);
            return null;
        }

        try {
            const buffer = await this.storage.read(id);
            const base64Content = `data:${asset.mime};base64,${buffer.toString("base64")}`;
            await this.ctx.database.set(TableName.Assets, { id }, { lastUsedAt: new Date() });
            return { data: asset, content: base64Content };
        } catch (error) {
            this.logger.error(`Failed to read asset ${id}: ${error.message}`);
            return null;
        }
    }

    /**
     * 兼容 ImageService 的 getImageDataWithContent 方法
     * @param id 资源 ID
     * @returns 包含图片数据和 Base64 内容的对象
     */
    public async getImageDataWithContent(id: string): Promise<{ data: AssetData; content: string } | null> {
        return this.getAssetDataWithContent(id);
    }

    /**
     * 兼容 ImageService 的 getImageLocalPath 方法
     * @param id 资源 ID
     * @returns 资源的本地存储路径
     */
    public async getImageLocalPath(id: string): Promise<string | null> {
        const [asset] = await this.ctx.database.get(TableName.Assets, { id });
        if (!asset) return null;

        // 对于 assets 服务，我们返回存储驱动的路径
        // 这主要用于兼容性，实际应该使用 read() 方法
        if (this.storage instanceof LocalStorageDriver) {
            return this.storage.getPath(id);
        }

        return null;
    }

    /**
     * 处理图片元素（兼容 ImageService 接口）
     * @param element 图片元素
     * @param session 当前会话
     * @returns 处理后的元素
     */
    public async processImageElement(element: Element, session: Session): Promise<Element> {
        const url = element.attrs.src;
        if (!url) {
            this.logger.warn("Image element missing 'src' attribute");
            return null;
        }

        try {
            const id = await this.create(url, {
                type: AssetType.Image,
                filename: element.attrs.filename,
            });
            return h("image", {
                id,
                summary: element.attrs.summary || element.attrs.alt || "图片",
            });
        } catch (error) {
            this.logger.error(`Failed to process image element: ${error.message}`);
            return h.text(`[图片加载失败: ${url.substring(0, 50)}]`);
        }
    }
}
