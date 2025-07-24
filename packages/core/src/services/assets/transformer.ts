import { Context, Dict, h, Logger } from "koishi";
import { Services } from "../types";
import { AssetService } from "./service";
import { AssetType } from "./types";

export class MessageTransformer {
    private logger: Logger;
    private assets: AssetService;

    constructor(private ctx: Context) {
        this.logger = ctx.logger("[消息转换器]");
        this.assets = ctx[Services.Asset];

        if (!this.assets) {
            throw new Error(`AssetService (${Services.Asset}) is not available.`);
        }
    }

    /**
     * 注册中间件，自动将接收到的消息中的资源元素（如图片）持久化。
     */
    public register() {
        // 解码中间件 (Decode): 将平台消息的 `src` 转换为内部 `id`
        this.ctx.middleware(async (session, next) => {
            const handle = async (type: AssetType, attrs: Dict, tagName: string) => {
                if (!attrs.src || attrs.id) return h(tagName, attrs);
                try {
                    const id = await this.assets.create(attrs.src, { type, filename: attrs.filename });
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
                            return handle(AssetType.Image, element.attrs, "img");
                        case "audio":
                            return handle(AssetType.Audio, element.attrs, "audio");
                        case "video":
                            return handle(AssetType.Video, element.attrs, "video");
                        case "file":
                            return handle(AssetType.File, element.attrs, "file");
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
                const src = await this.assets.getPublicUrl(attrs.id);
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
}
