import { Context, h, Logger, Session,Element } from "koishi";
import { Services } from "../types";
import { AssetService } from "./service";

/**
 * 消息编解码器
 * 负责在平台原生消息和包含内部资源ID的、对LLM友好的消息之间进行双向转换
 */
export class MessageTransformer {
    private logger: Logger;
    private assetService: AssetService;

    constructor(private ctx: Context) {
        this.logger = ctx[Services.Logger].getLogger("[消息编解码器]");
        this.assetService = ctx[Services.Asset];
    }

    /**
     * 注册消息转换中间件
     */
    public register(): void {
        // 解码中间件：将平台消息转换为LLM友好格式
        this.ctx.middleware(async (session, next) => {
            try {
                // 转换消息元素
                session.elements = await h.transformAsync(session.elements, this.getDecodeRules(session));
                this.logger.debug(`消息已解码: ${session.messageId}`);
            } catch (error) {
                this.logger.error(`消息解码失败: ${error.message}`);
            }
            return next();
        }, true); // 高优先级，确保在其他插件之前执行

        this.logger.info("消息转换中间件已注册");
    }

    /**
     * 获取解码规则
     * 将平台原生的资源元素转换为包含内部ID的元素
     */
    private getDecodeRules(session: Session): any {
        return {
            // 转换图片元素
            async img(attrs) {
                if (!attrs.src || attrs.id) {
                    // 如果没有src或已有id，保持原样
                    return h('img', attrs);
                }

                try {
                    // 创建资源并获取内部ID
                    const id = await this.assetService.create(attrs.src, {
                        filename: attrs.filename,
                        session
                    });

                    // 返回使用内部ID的新元素，保留其他属性
                    return h('img', {
                        id,
                        summary: attrs.summary || "图片",
                        ...this.filterAttrs(attrs, ['src']) // 移除src，保留其他属性
                    });
                } catch (error) {
                    this.logger.error(`图片资源创建失败: ${attrs.src} - ${error.message}`);
                    // 创建失败时返回错误提示
                    return h.text(`[图片加载失败: ${this.truncateUrl(attrs.src)}]`);
                }
            },

            // 转换音频元素
            async audio(attrs) {
                if (!attrs.src || attrs.id) {
                    return h('audio', attrs);
                }

                try {
                    const id = await this.assetService.create(attrs.src, {
                        filename: attrs.filename,
                        session
                    });

                    return h('audio', {
                        id,
                        ...this.filterAttrs(attrs, ['src'])
                    });
                } catch (error) {
                    this.logger.error(`音频资源创建失败: ${attrs.src} - ${error.message}`);
                    return h.text(`[音频加载失败: ${this.truncateUrl(attrs.src)}]`);
                }
            },

            // 转换视频元素
            async video(attrs) {
                if (!attrs.src || attrs.id) {
                    return h('video', attrs);
                }

                try {
                    const id = await this.assetService.create(attrs.src, {
                        filename: attrs.filename,
                        session
                    });

                    return h('video', {
                        id,
                        ...this.filterAttrs(attrs, ['src'])
                    });
                } catch (error) {
                    this.logger.error(`视频资源创建失败: ${attrs.src} - ${error.message}`);
                    return h.text(`[视频加载失败: ${this.truncateUrl(attrs.src)}]`);
                }
            },

            // 转换文件元素
            async file(attrs) {
                if (!attrs.src || attrs.id) {
                    return h('file', attrs);
                }

                try {
                    const id = await this.assetService.create(attrs.src, {
                        filename: attrs.filename,
                        session
                    });

                    return h('file', {
                        id,
                        name: attrs.name || attrs.filename || "文件",
                        ...this.filterAttrs(attrs, ['src'])
                    });
                } catch (error) {
                    this.logger.error(`文件资源创建失败: ${attrs.src} - ${error.message}`);
                    return h.text(`[文件加载失败: ${this.truncateUrl(attrs.src)}]`);
                }
            }
        };
    }

    /**
     * 编码消息：将包含内部ID的元素转换为平台可识别的格式
     * 这个方法供发送消息时调用
     */
    public async encodeMessage(elements: h[]): Promise<h[]> {
        try {
            const encodedElements = await h.transformAsync(elements, this.getEncodeRules());
            this.logger.debug("消息已编码");
            return encodedElements;
        } catch (error) {
            this.logger.error(`消息编码失败: ${error.message}`);
            return elements; // 编码失败时返回原始元素
        }
    }

    /**
     * 获取编码规则
     * 将包含内部ID的元素转换为平台原生格式
     */
    private getEncodeRules(): any {
        return {
            // 编码图片元素
            async img(attrs) {
                if (!attrs.id) {
                    return h('img', attrs);
                }

                try {
                    // 获取公开访问URL
                    const url = await this.assetService.getURL(attrs.id);
                    return h('img', {
                        src: url,
                        ...this.filterAttrs(attrs, ['id'])
                    });
                } catch (error) {
                    this.logger.error(`获取图片URL失败: ${attrs.id} - ${error.message}`);
                    return h.text(`[图片: ${attrs.id}]`);
                }
            },

            // 编码音频元素
            async audio(attrs) {
                if (!attrs.id) {
                    return h('audio', attrs);
                }

                try {
                    const url = await this.assetService.getURL(attrs.id);
                    return h('audio', {
                        src: url,
                        ...this.filterAttrs(attrs, ['id'])
                    });
                } catch (error) {
                    this.logger.error(`获取音频URL失败: ${attrs.id} - ${error.message}`);
                    return h.text(`[音频: ${attrs.id}]`);
                }
            },

            // 编码视频元素
            async video(attrs) {
                if (!attrs.id) {
                    return h('video', attrs);
                }

                try {
                    const url = await this.assetService.getURL(attrs.id);
                    return h('video', {
                        src: url,
                        ...this.filterAttrs(attrs, ['id'])
                    });
                } catch (error) {
                    this.logger.error(`获取视频URL失败: ${attrs.id} - ${error.message}`);
                    return h.text(`[视频: ${attrs.id}]`);
                }
            },

            // 编码文件元素
            async file(attrs) {
                if (!attrs.id) {
                    return h('file', attrs);
                }

                try {
                    const url = await this.assetService.getURL(attrs.id);
                    return h('file', {
                        src: url,
                        ...this.filterAttrs(attrs, ['id'])
                    });
                } catch (error) {
                    this.logger.error(`获取文件URL失败: ${attrs.id} - ${error.message}`);
                    return h.text(`[文件: ${attrs.name || attrs.id}]`);
                }
            }
        };
    }

    /**
     * 过滤属性，移除指定的属性
     */
    private filterAttrs(attrs: any, excludeKeys: string[]): any {
        const filtered = { ...attrs };
        excludeKeys.forEach(key => delete filtered[key]);
        return filtered;
    }

    /**
     * 截断URL用于显示
     */
    private truncateUrl(url: string, maxLength: number = 50): string {
        if (url.length <= maxLength) return url;
        return url.substring(0, maxLength) + '...';
    }
}
