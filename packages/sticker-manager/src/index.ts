import { Context, Schema } from 'koishi';
import { Services } from 'koishi-plugin-yesimbot/services';
import { StickerService } from './service';
import { StickerTools } from './tool';

export interface StickerConfig {
    storagePath: string;
    classificationPrompt: string;
}

export const StickerConfig = Schema.object({
    storagePath: Schema.path({ allowCreate: true, filters: ['directory'] })
        .default('./data/yesimbot/sticker')
        .description('表情包存储路径'),
    classificationPrompt: Schema.string()
        .default('请将以下图片分类，已有分类: [{{categories}}]。选择最匹配的分类或创建新分类。只返回分类名称。')
        .description('多模态分类提示词模板'),
});

export function apply(ctx: Context, config: StickerConfig) {
    ctx.plugin(StickerService, config);
    ctx.plugin(StickerTools);
}

export const name = 'sticker-manager';