import { Context, Schema, Session, h } from 'koishi';
import { Extension, Failed, Infer, Success, Tool } from "koishi-plugin-yesimbot/services";
import { StickerService } from './service';

export interface StickerConfig {
    storagePath: string;
    classificationPrompt: string;
}

@Extension({
    name: 'sticker-manager',
    display: '表情包管理',
    description: '用于偷取和发送表情包',
    author: 'HydroGest',
    version: '1.0.0',
})
export default class StickerTools {
    static readonly inject = ["database", "yesimbot.model", "yesimbot.image", "yesimbot.prompt"];

    static readonly Config: Schema<StickerConfig> = Schema.object({
        storagePath: Schema.path({ allowCreate: true, filters: ['directory'] })
            .default('data/yesimbot/sticker')
            .description('表情包存储路径'),
        classificationPrompt: Schema.string()
            .default('请将以下图片分类，已有分类: [{{categories}}]。选择最匹配的分类或创建新分类。只返回分类名称。建议按照可能的语境分类')
            .description('多模态分类提示词模板，可使用 {{categories}} 占位符动态插入分类列表'),
    });

    private stickerService: StickerService;

    private static serviceInstance: StickerService | null = null;
    
    constructor(public ctx: Context, public config: StickerConfig) {
        // 确保只创建一个服务实例
        if (!StickerTools.serviceInstance) {
            StickerTools.serviceInstance = new StickerService(ctx, config);
        }
        
        this.stickerService = StickerTools.serviceInstance;
        
        ctx.on("ready", async () => {
            // 等待服务完全启动
            await this.stickerService.whenReady();
            
            try {
                // 确保只初始化一次
                if (!this.initialized) {
                    this.initialized = true;
                    this.stickerService.logger.info("插件已成功启动");
                    await this.registerToolDescriptions();
                }
            } catch (error) {
                this.stickerService.logger.warn("插件初始化失败！");
                this.stickerService.logger.error(error);
            }
        });
    }
    
    private initialized = false;
    
    // 添加服务就绪等待方法
    private async whenReady() {
        return new Promise<void>((resolve) => {
            const check = () => {
                if (this.stickerService.isReady) {
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    }

    private async registerToolDescriptions() {
        const categories = await this.stickerService.getCategories();
        const categoryList = categories.join(', ');
        
        // 更新发送表情包工具的描述
        this.ctx['yesimbot.tool'].registerTool({
            name: 'send_random_sticker',
            description: `发送一个随机表情包。可用分类: ${categoryList}`,
            parameters: Schema.object({
                category: Schema.string().required().description(`表情包分类名称，可用选项: ${categoryList}`),
            }),
            // 使用 bind 方法确保正确的 this 上下文
            execute: this.sendRandomSticker.bind(this)
        });
    }

    @Tool({
        name: 'steal_sticker',
        description: '偷取一个表情包。当用户发送表情包时，调用此工具将表情包保存到本地并分类。',
        parameters: Schema.object({
            image_id: Schema.string().required().description('要偷取的表情图片ID'),
        }),
    })
    async stealSticker({ image_id, session }: Infer<{ image_id: string }> & { session: Session }) {
        try {
            const imageService = this.ctx['yesimbot.image'];
            
            const imageData = await imageService.getImageDataWithContent(image_id);
            if (!imageData) return Failed('图片未找到');
            
            const record = await this.stickerService.stealSticker(imageData.data, session);
            return Success({
                id: record.id,
                category: record.category,
                message: `已偷取表情包到分类: ${record.category}`
            });
        } catch (error) {
            return Failed(`偷取失败: ${error.message}`);
        }
    }

    // 改回普通方法，使用 bind 确保上下文
    @Tool({
        name: 'send_random_sticker',
        description: '发送一个随机表情包。',
        parameters: Schema.object({
            category: Schema.string().required().description('表情包分类名称'),
        }),
    })
    async sendRandomSticker({ session, category }: Infer<{ category: string }>) {
        try {
            const sticker = await this.stickerService.getRandomSticker(category);
            
            if (!sticker) return Failed(`分类 "${category}" 中没有表情包`);
            
            await session.sendQueued(sticker);

            return Success({
                element: sticker,
                message: `已发送 ${category} 分类的表情包`
            });
        } catch (error) {
            return Failed(`发送失败: ${error.message}`);
        }
    }
}