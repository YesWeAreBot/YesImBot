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
   
    static readonly inject = ["database", "yesimbot.model", "yesimbot.image"];

    static readonly Config: Schema<StickerConfig> = Schema.object({
        storagePath: Schema.path({ allowCreate: true, filters: ['directory'] })
            .default('data/yesimbot/sticker')
            .description('表情包存储路径'),
        classificationPrompt: Schema.string()
            .default('请将以下图片分类，已有分类: [{{categories}}]。选择最匹配的分类或创建新分类。只返回分类名称。')
            .description('多模态分类提示词模板'),
    });
    private stickerService: StickerService;

    constructor(public ctx: Context, public config: StickerConfig) {
        this.stickerService = new StickerService(ctx, config);
        
        ctx.on("ready", async () => {
            //ctx.plugin(StickerService);
            try {
                this.stickerService.logger.info("插件已成功启动");
            } catch (error) {
                this.stickerService.logger.warn("插件初始化失败！");
                this.stickerService.logger.error(error);
            }
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

            //const stickerService = this.ctx.plugin.get(StickerService);
            
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

    @Tool({
        name: 'send_random_sticker',
        description: '发送一个随机表情包。',
        parameters: Schema.object({
            category: Schema.string().required().description('表情包分类名称'),
        }),
    })
    async sendRandomSticker({ session ,category }: Infer<{ category: string }>) {
        try {
            //const stickerService = this.ctx.plugin.get(StickerService);
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