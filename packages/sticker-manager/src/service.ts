import { Context, h, Logger, Schema, Session } from 'koishi';
import { createHash, subtle } from 'crypto';
import { mkdir, readdir, rename, unlink, readFile } from 'fs/promises';
import { pathToFileURL } from 'url';
import path from 'path';
import { StickerConfig } from './index';
import { Services, TableName, TaskType } from 'koishi-plugin-yesimbot/services';
import { ImageData } from 'koishi-plugin-yesimbot/services';

declare module "koishi" {
    interface Tables {
		[TableName.Stickers]: StickerRecord;
    }
}

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
    public logger: Logger;
    
    private static tablesRegistered = false;
    public isReady: boolean = false;

    constructor(private ctx: Context, private config: StickerConfig) {
        this.logger = ctx[Services.Logger].getLogger('[表情管理]');
        this.start();
    }

        private async start() {
        // 确保初始化只执行一次
        if (this.isReady) return;
        
        await this.initStorage();
        await this.registerModels();
        this.registerPromptSnippet();
        
        // 标记服务已就绪
        this.isReady = true;
        this.logger.debug('表情包服务已就绪');
    }

    public whenReady() {
        return new Promise<void>((resolve) => {
            if (this.isReady) {
                resolve();
            } else {
                const check = () => {
                    if (this.isReady) {
                        resolve();
                    } else {
                        setTimeout(check, 100);
                    }
                };
                check();
            }
        });
    }

    private registerPromptSnippet() {
        const promptService = this.ctx[Services.Prompt];
        if (!promptService) {
            this.logger.warn('提示词服务未找到，无法注册分类列表');
            return;
        }
        
        // 注册动态片段
        promptService.registerSnippet('sticker.categories', async () => {
            const categories = await this.getCategories();
            return categories.join(', ');
        });
        
        this.logger.debug('表情包分类列表已注册到提示词系统');
    }

    private async initStorage() {
        await mkdir(this.config.storagePath, { recursive: true });
        this.logger.info(`表情存储目录已初始化: ${this.config.storagePath}`);
    }

    private async registerModels() {
        // 确保表只注册一次
        if (StickerService.tablesRegistered) return;
        StickerService.tablesRegistered = true;
        
        try {
            // 使用 extend 创建表
            this.ctx.model.extend(TableName.Stickers, {
                id: 'string(64)',
                category: 'string(255)',
                filePath: 'string(255)',
                source: 'json',
                createdAt: 'timestamp',
            }, { primary: 'id' });
            
            this.logger.debug('表情包表已创建');
        } catch (error) {
            this.logger.error('创建表情包表失败', error);
            throw error;
        }
    }

    public async stealSticker(imageData: ImageData, session: Session): Promise<StickerRecord> {
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
        const destPath = path.resolve(this.config.storagePath, `${stickerId}.${extension}`);

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

    private async classifySticker(filePath: string): Promise<string> {
        // 动态获取分类列表
        const categories = await this.getCategories();
        const categoryList = categories.join(', ');
        
        // 使用分类列表替换模板中的占位符
        const prompt = this.config.classificationPrompt
            .replace('{{categories}}', categoryList);
        
        const models = this.ctx[Services.Model].useChatGroup(TaskType.Chat);

        const model = models.models.find((m) => m.isVisionModel());
        if (!model) {
            this.logger.error(`当前模型组中没有支持多模态的模型。`);
            throw Error();
        }
        
        try {
            // 读取文件内容并转换为base64
            const fileBuffer = await readFile(filePath);
            const base64Image = fileBuffer.toString('base64');
            
            // 获取文件扩展名（不带点）
            const extension = path.extname(filePath).slice(1).toLowerCase();
            
            // 处理特殊扩展名
            let mimeType = `image/${extension}`;
            if (extension === 'jpg') mimeType = 'image/jpeg';
            
            const response = await model.chat({
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt }, // 使用动态生成的提示词
                        { 
                            type: 'image_url', 
                            image_url: { 
                                url: `data:${mimeType};base64,${base64Image}` 
                            }
                        }
                    ]
                }]
            });
            
            return response.text.trim();
        } catch (error) {
            this.logger.error('表情分类失败', error);
            return '分类失败';
        }
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

        const fileUrl = pathToFileURL(sticker.filePath).href;

        return h.image(fileUrl, { "sub-type": "1" });
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
