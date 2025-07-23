import { Context, Schema, Session } from 'koishi';
import { Extension, Failed, Infer, Success, Tool } from "koishi-plugin-yesimbot/services";
import { Services } from 'koishi-plugin-yesimbot/services';
import { StickerService } from './service';

@Extension({
    name: 'sticker-manager',
    display: '表情包管理',
    description: '用于偷取和发送表情包',
    author: 'HydroGest',
    version: '1.0.0',
})
export class StickerTools {

    private stickerService: StickerService;

    constructor(private ctx: Context) {
        // 正确获取 StickerService 实例
        this.stickerService = ctx.get('sticker-service') as StickerService;
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
            const imageService = this.ctx[Services.Image];

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
    async sendRandomSticker({ category }: Infer<{ category: string }>) {
        try {
            //const stickerService = this.ctx.plugin.get(StickerService);
            const sticker = await this.stickerService.getRandomSticker(category);
            
            if (!sticker) return Failed(`分类 "${category}" 中没有表情包`);
            
            return Success({
                element: sticker,
                message: `已发送 ${category} 分类的表情包`
            });
        } catch (error) {
            return Failed(`发送失败: ${error.message}`);
        }
    }
}