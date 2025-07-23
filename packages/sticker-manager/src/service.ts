import { Context, h, Logger, Schema, Session } from 'koishi';
import { createHash } from 'crypto';
import { mkdir, readdir, rename, unlink } from 'fs/promises';
import path from 'path';
import { StickerConfig } from './index';
import { Services, TableName, TaskType } from 'koishi-plugin-yesimbot/services';
import { ImageData } from 'koishi-plugin-yesimbot/services';

interface StickerRecord {
    id: string;
    category: string;
    filePath: string;
    source: {
        platform: string;
        channelId: string;
        userId: string;
        messageId: string;
    };
    createdAt: Date;
}

export class StickerService {
    static readonly inject = ["database", Services.Logger, Services.Model];
    private logger: Logger;

    constructor(private ctx: Context, private config: StickerConfig) {
        this.logger = ctx[Services.Logger].getLogger('[表情管理]');
    }

    async start() {
        await this.initStorage();
        this.registerModels();
    }

    private async initStorage() {
        await mkdir(this.config.storagePath, { recursive: true });
        this.logger.info(`表情存储目录已初始化: ${this.config.storagePath}`);
    }

    private registerModels() {
        // @ts-ignore
        this.ctx.model.extend(TableName.Stickers, {
            id: 'string(64)',
            category: 'string(255)',
            filePath: 'string(255)',
            source: 'json',
            createdAt: 'timestamp',
        }, { primary: 'id' });
    }

    async stealSticker(imageData: ImageData, session: Session): Promise<StickerRecord> {
        const { id, originalUrl, mimeType } = imageData;

        // 获取图片的实际文件路径
        const imageService = this.ctx[Services.Image];
        const filePath = await imageService.getImageLocalPath(id);

        if (!filePath) {
            throw new Error('找不到图片本地文件');
        }

        // 生成唯一ID - 使用URL作为哈希输入
        const hash = createHash('sha256');
        hash.update(originalUrl || imageData.id);
        const stickerId = hash.digest('hex');

        // 目标文件路径
        const extension = mimeType ? mimeType.split('/')[1] || 'png' : 'png';
        const destPath = path.join(this.config.storagePath, `${stickerId}.${extension}`);

        // 移动文件到表情目录
        await rename(filePath, destPath);

        // 分类表情
        // @ts-ignore
        const category = await this.classifySticker(destPath);

        // 创建数据库记录
        const record: StickerRecord = {
            id: stickerId,
            category,
            filePath: destPath,
            source: {
                platform: session.platform,
                channelId: session.channelId,
                userId: session.userId,
                messageId: session.messageId,
            },
            createdAt: new Date(),
        };

        await this.ctx.database.create(TableName.Stickers, record);
        this.logger.debug(`已保存表情: ${category} - ${stickerId}`);
        return record;
    }


    private async classifySticker(imageBuffer: Buffer): Promise<string> {
        const categories = await this.getCategories();
        const models = this.ctx[Services.Model].useChatGroup(TaskType.Chat);

        const model = models.models.find((m) => m.isVisionModel());
        if (!model) {
            this.logger.error(`当前模型组中没有支持多模态的模型。`);
            throw Error();
        }
        
        const prompt = this.config.classificationPrompt
            .replace('{{categories}}', categories.join(', '));

        const response = await model.chat({
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBuffer.toString('base64')}` } }
                ]
            }]
        });

        return response.text.trim();
    }

    async getCategories(): Promise<string[]> {

        const records = await this.ctx.database.select(TableName.Stickers).execute();

        return [...new Set(records.map(r => r.category))];
    }

    async getRandomSticker(category: string): Promise<h> {

        const records = await this.ctx.database.select(TableName.Stickers).where({ category })
            .execute();

        if (records.length === 0) return null;

        const randomIndex = Math.floor(Math.random() * records.length);
        const sticker = records[randomIndex];

        return h.image(`file://${sticker.filePath}`);
    }

    async cleanupUnreferenced() {
        const dbFiles = new Set((await this.ctx.database.select(TableName.Stickers).execute()).map(r => path.basename(r.filePath)));
        const fsFiles = await readdir(this.config.storagePath);

        for (const file of fsFiles) {
            if (!dbFiles.has(file)) {
                await unlink(path.join(this.config.storagePath, file));
                this.logger.debug(`清理未引用表情: ${file}`);
            }
        }
    }
}

function getFileExtension(mimeType: string): string {
    return mimeType.split('/')[1] || 'png';
}