import { Services, TableName } from "@/shared/constants";
import { createHash } from "crypto";
import { fromBuffer } from "file-type";
import { promises as fs } from "fs";
import { Context, Dict, Element, Service, h } from "koishi";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { AssetServiceConfig } from "./config";
import { LocalStorageDriver } from "./drivers";
import { AssetData, AssetInfo, AssetMetadata, AssetType, StorageDriver } from "./types";
import { formatSize, truncate } from "@/shared/utils";

declare module "koishi" {
    interface Context {
        [Services.Asset]: AssetService;
    }
    interface Tables {
        [TableName.Assets]: AssetData;
    }
}

export class AssetService extends Service<AssetServiceConfig> {
    static readonly inject = ["database", "server", Services.Logger];
    private storage: StorageDriver;

    constructor(ctx: Context, config: AssetServiceConfig) {
        super(ctx, Services.Asset, true);
        this.config = config;
        this.logger = ctx[Services.Logger].getLogger("[资源服务]");
    }

    protected async start() {
        this.storage = new LocalStorageDriver(this.ctx, { path: this.config.storagePath });
        this.logger.debug(`本地存储驱动已初始化, 路径: ${this.config.storagePath}`);

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
            this.logger.info(`已启用资源自动清理功能, 清理超过 ${this.config.maxAssetAgeDays} 天未使用的资源`);
        }

        if (this.config.endpoint) {
            this.registerHttpEndpoint();
        }
    }

    public async transform(source: string): Promise<string> {
        const handle = async (type: AssetType, attrs: Dict, tagName: string) => {
            const originalUrl = attrs.src || attrs.url || attrs.file;
            if (!originalUrl && attrs.id) return h(tagName, attrs); // 如果没有源或已有ID, 直接返回
            try {
                const metadata = {
                    filename: attrs.filename || attrs.fileName,
                    src: originalUrl,
                    summary: attrs.summary,
                };
                const id = await this.create(originalUrl, type, metadata);
                // 持久化成功后, 仅保留ID和其他非src属性
                const { src, ...display } = metadata;
                return h(tagName, { id, ...display });
            } catch (error) {
                this.logger.error(`持久化资源失败 | 源: "${originalUrl}" | 原因: ${error.message}`);
                // 失败时返回原始元素, 保证消息能继续发送
                return h(type, attrs);
            }
        };
        try {
            return await h.transformAsync(source, async (element) => {
                switch (element.type) {
                    case "img":
                    case "image":
                        return handle(AssetType.Image, element.attrs, "img");
                    case "audio":
                        return handle(AssetType.Audio, element.attrs, "audio");
                    case "video":
                        return handle(AssetType.Video, element.attrs, "video");
                    case "file":
                        return handle(AssetType.File, element.attrs, "file");
                    // 兼容 mface
                    case "mface":
                        return handle(AssetType.Image, element.attrs, "img");
                    default:
                        return element;
                }
            });
        } catch (error) {
            this.logger.warn(`转换消息元素时发生未知错误: ${error.message}`);
            return source;
        }
    }

    /**
     * 将消息中带有内部 ID 的资源元素转换为平台可发送的 URL 格式.
     * @param source 待编码的消息字符串或元素数组
     * @returns 编码后的消息元素数组
     */
    public async encode(source: string | Element[]): Promise<Element[]> {
        const handle = async (attrs: Dict, tagName: string) => {
            if (!attrs.id) return h(tagName, attrs);
            try {
                const src = await this.getPublicUrl(attrs.id);
                const { id, ...rest } = attrs;
                return h(tagName, { ...rest, src });
            } catch (error) {
                this.logger.error(`获取资源 "${attrs.id}" 的公开链接失败: ${error.message}`);
                return h(tagName, attrs);
            }
        };
        if (typeof source === "string") {
            source = h.parse(source);
        }
        return h.transformAsync(source, async (element) => {
            switch (element.type) {
                case "img": case "image": return handle(element.attrs, "img");
                case "audio": return handle(element.attrs, "audio");
                case "video": return handle(element.attrs, "video");
                case "file": return handle(element.attrs, "file");
                default: return element;
            }
        });
    }

    /**
     * 创建一个新资源.
     * 此方法会处理不同来源 (Buffer, data:, file:, http(s):) 的资源,
     * 进行大小校验、哈希查重、文件存储和数据库记录, 最终返回资源的唯一ID.
     * @param source 资源的来源, 可以是 Buffer, data URL, file URL 或 http/https URL.
     * @param type 资源的类型.
     * @param metadata 资源的元数据.
     * @returns 资源的唯一 ID.
     */
    public async create(source: string | Buffer, type: AssetType, metadata: AssetMetadata = {}): Promise<string> {
        try {
            let buffer: Buffer;
            let mime: string | undefined;

            if (Buffer.isBuffer(source)) {
                this.logger.debug("从 Buffer 创建资源");
                buffer = source;
            } else if (typeof source === "string") {
                if (source.startsWith("data:")) {
                    this.logger.debug("从 data: URL 创建资源");
                    const match = source.match(/^data:([^;]+);base64,(.*)$/);
                    if (!match) throw new Error("无效的 data: URL 格式");
                    mime = match[1];
                    buffer = Buffer.from(match[2], "base64");
                } else if (source.startsWith("file://")) {
                    this.logger.debug(`从 file: URL 创建资源: ${source}`);
                    const filePath = fileURLToPath(source);
                    buffer = await fs.readFile(filePath);
                } else if (source.startsWith("http")) {
                    this.logger.debug(`从 http(s): URL 创建资源: ${source}`);
                    const response = await this.ctx.http(source, {
                        method: "GET",
                        responseType: "arraybuffer",
                        timeout: this.config.downloadTimeout,
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
                        },
                    });
                    if (response.status < 200 || response.status >= 300) {
                        throw new Error(`下载失败, HTTP 状态码: ${response.status}`);
                    }
                    mime = response.headers["content-type"];
                    buffer = Buffer.from(response.data);
                } else {
                    throw new Error(`不支持的资源来源: "${truncate(source, 50)}"`);
                }
            } else {
                throw new Error("无效的资源来源类型");
            }

            if (!buffer || buffer.length === 0) {
                throw new Error("资源内容为空");
            }

            if (buffer.length > this.config.maxFileSize) {
                throw new Error(`文件大小 (${formatSize(buffer.length)}) 超出限制 (${formatSize(this.config.maxFileSize)})`);
            }

            const hash = createHash("sha256").update(buffer).digest("hex");
            const existing = await this.ctx.database.get(TableName.Assets, { hash });

            if (existing.length > 0) {
                const assetId = existing[0].id;
                this.logger.debug(`资源哈希命中 | ID: ${assetId} | 更新最后使用时间`);
                await this.ctx.database.set(TableName.Assets, { id: assetId }, { lastUsedAt: new Date() });
                return assetId;
            }

            // 如果 MIME 未知, 则从 buffer 推断
            mime = mime || (await fromBuffer(buffer).then((info) => info?.mime)) || "application/octet-stream";

            const id = uuidv4();
            await this.storage.write(id, buffer);

            const assetData: AssetData = {
                id,
                type,
                mime,
                hash,
                size: buffer.length,
                createdAt: new Date(),
                lastUsedAt: new Date(),
                metadata,
            };

            await this.ctx.database.create(TableName.Assets, assetData);
            this.logger.info(`成功创建新资源 | ID: ${id} | 类型: ${mime} | 大小: ${formatSize(buffer.length)}`);
            return id;
        } catch (error) {
            this.logger.error(`创建资源时发生错误: ${error.message}`);
            // 将错误继续向上抛出, 以便调用方 (如 transform) 能捕获到
            throw error;
        }
    }

    /**
     * 根据 ID 读取资源的二进制内容.
     * @param id 资源 ID
     * @returns 资源的 Buffer.
     */
    public async read(id: string): Promise<Buffer> {
        const [asset] = await this.ctx.database.get(TableName.Assets, { id });
        if (!asset) throw new Error(`找不到资源 | ID: "${id}"`);

        const buffer = await this.storage.read(id);
        await this.ctx.database.set(TableName.Assets, { id }, { lastUsedAt: new Date() });
        return buffer;
    }

    /**
     * 根据 ID 获取资源的元信息.
     * @param id 资源 ID
     * @returns 资源的元信息.
     */
    public async getInfo(id: string): Promise<AssetInfo> {
        const [asset] = await this.ctx.database.get(TableName.Assets, { id });
        if (!asset) throw new Error(`找不到资源 | ID: "${id}"`);

        await this.ctx.database.set(TableName.Assets, { id }, { lastUsedAt: new Date() });
        const { hash, ...info } = asset; // 排除内部字段 hash
        return info;
    }

    /**
     * 获取资源的公开访问链接.
     * 如果配置了 endpoint, 则返回基于 endpoint 的 URL.
     * 否则, 返回 Base64 编码的 Data URL.
     * @param id 资源 ID
     * @returns 资源的公开链接
     */
    public async getPublicUrl(id: string): Promise<string> {
        const [asset] = await this.ctx.database.get(TableName.Assets, { id });
        if (!asset) throw new Error(`找不到资源 | ID: "${id}"`);

        await this.ctx.database.set(TableName.Assets, { id }, { lastUsedAt: new Date() });

        if (this.config.endpoint) {
            const endpoint = this.config.endpoint.endsWith("/") ? this.config.endpoint : `${this.config.endpoint}/`;
            return `${endpoint}${id}`;
        } else {
            this.logger.warn(`未配置公开访问端点, 将为资源 ${id} 回退到 Base64 Data URL. 这对于大文件可能效率低下`);
            const buffer = await this.storage.read(id);
            return `data:${asset.mime};base64,${buffer.toString("base64")}`;
        }
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

    private registerHttpEndpoint() {
        const route = this.config.endpoint.startsWith("/")
            ? this.config.endpoint
            : new URL(this.config.endpoint).pathname;

        this.ctx.server.get(`${route}/:id`, async (ctx) => {
            const { id } = ctx.params;
            try {
                const info = await this.getInfo(id); // getInfo 内部会更新 lastUsedAt
                const buffer = await this.storage.read(id);
                ctx.status = 200;
                ctx.set("Content-Type", info.mime);
                ctx.set("Content-Length", info.size.toString());
                // 为资源设置长期缓存, 优化客户端加载
                ctx.set("Cache-Control", "public, max-age=31536000, immutable");
                ctx.body = buffer;
            } catch (err) {
                this.logger.warn(`通过 HTTP 端点提供资源 ${id} 失败: ${err.message}`);
                ctx.status = 404;
                ctx.body = "Asset not found";
            }
        });
        this.logger.info(`HTTP 服务端点已注册: GET ${route}/:id`);
    }

    private async runAutoClear() {
        this.logger.info("开始执行过期资源自动清理任务..");
        const cutoff = new Date(Date.now() - this.config.maxAssetAgeDays * 24 * 3600 * 1000);
        const expiredAssets = await this.ctx.database.get(TableName.Assets, { lastUsedAt: { $lt: cutoff } });

        if (!expiredAssets.length) {
            this.logger.info("没有需要清理的过期资源");
            return;
        }

        this.logger.info(`发现 ${expiredAssets.length} 个待清理的过期资源`);
        let successCount = 0;
        for (const asset of expiredAssets) {
            try {
                await this.storage.delete(asset.id);
                successCount++;
            } catch (error) {
                this.logger.error(`删除资源 ${asset.id} 的物理文件失败: ${error.message}`);
            }
        }
        this.logger.info(`已成功删除 ${successCount} 个物理文件`);

        const idsToDelete = expiredAssets.map((a) => a.id);
        const { removed } = await this.ctx.database.remove(TableName.Assets, { id: { $in: idsToDelete } });
        this.logger.info(`成功从数据库中清理了 ${removed} 个资源记录`);
    }
}