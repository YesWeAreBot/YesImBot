import type { Context, Session } from "koishi";
import type { PromptService } from "koishi-plugin-yesimbot/services";
import type { StickerConfig } from "./config";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { h } from "koishi";
import { Services } from "koishi-plugin-yesimbot/shared";

// 添加表情包表结构
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

interface ImportStats {
    total: number; // 总尝试导入数
    success: number; // 成功导入数
    failed: number; // 导入失败数
    skipped: number; // 跳过数（重复表情包）
    failedFiles?: string[]; // 失败的文件名列表
    failedUrls?: {
        // 失败的 URL 列表
        url: string;
        error: string;
    }[];
}

const TableName = "yesimbot.stickers";

declare module "koishi" {
    interface Tables {
        [TableName]: StickerRecord;
    }
}

export class StickerService {
    private static tablesRegistered = false;
    public isReady: boolean = false;

    constructor(
        private ctx: Context,
        private config: StickerConfig,
    ) {
        this.start();
    }

    private async start() {
        // 确保初始化只执行一次
        if (this.isReady)
            return;

        await this.initStorage();
        await this.registerModels();
        this.registerPromptSnippet();

        // 标记服务已就绪
        this.isReady = true;
        this.ctx.logger.debug("表情包服务已就绪");
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
        const promptService: PromptService = this.ctx[Services.Prompt];
        if (!promptService) {
            this.ctx.logger.warn("提示词服务未找到，无法注册分类列表");
            return;
        }

        // 注册动态片段
        promptService.registerSnippet("sticker.categories", async () => {
            const categories = await this.getCategories();
            return categories.join(", ") || "暂无分类，请先收藏表情包";
        });

        this.ctx.logger.debug("表情包分类列表已注册到提示词系统");
    }

    private async initStorage() {
        await mkdir(this.config.storagePath, { recursive: true });
        this.ctx.logger.info(`表情存储目录已初始化: ${this.config.storagePath}`);
    }

    private async registerModels() {
        // 确保表只注册一次
        if (StickerService.tablesRegistered)
            return;
        StickerService.tablesRegistered = true;

        try {
            // 使用 extend 创建表
            this.ctx.model.extend(
                TableName,
                {
                    id: "string(64)",
                    category: "string(255)",
                    filePath: "string(255)",
                    source: "json",
                    createdAt: "timestamp",
                },
                { primary: "id" },
            );

            this.ctx.logger.debug("表情包表已创建");
        } catch (error: any) {
            this.ctx.logger.error("创建表情包表失败", error);
            throw error;
        }
    }

    /**
     * 偷取表情包
     * @param image_id string
     * @param session
     * @returns
     */
    public async stealSticker(image_id: string, session: Session): Promise<StickerRecord> {
        const assetService = this.ctx[Services.Asset];

        const imageDataForLLM = (await assetService.read(image_id, {
            format: "data-url",
            image: { process: true, format: "jpeg" },
        })) as string;
        const imageData = (await assetService.read(image_id, { format: "buffer" })) as Buffer;

        // 生成唯一ID - 使用URL作为哈希输入
        const hash = createHash("sha256");
        hash.update(image_id);
        const stickerId = hash.digest("hex");

        // 目标文件路径
        // 从b64获取mime
        const mimeType = imageDataForLLM.split(";")[0].split(":")[1];
        const extension = this.getExtensionFromContentType(mimeType) || "png";
        const destPath = path.resolve(this.config.storagePath, `${stickerId}.${extension}`);

        // 保存文件到表情目录
        await writeFile(destPath, imageData);

        // 分类表情
        const category = await this.classifySticker(imageDataForLLM);

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

        await this.ctx.database.create(TableName, record);
        this.ctx.logger.debug(`已保存表情: ${category} - ${stickerId}`);
        return record;
    }

    private async classifySticker(imageData: string): Promise<string> {
        // 动态获取分类列表
        const categories = await this.getCategories();
        const categoryList = categories.join(", ");

        // 使用分类列表替换模板中的占位符
        const prompt = this.config.classificationPrompt.replace("{{categories}}", categoryList);

        const model = this.ctx[Services.Model].getChatModel(this.config.classifiModel.providerName, this.config.classifiModel.modelId);

        if (!model || !model.isVisionModel()) {
            this.ctx.logger.error(`当前模型组中没有支持多模态的模型。`);
            throw new Error("没有可用的多模态模型");
        }

        try {
            const response = await model.chat({
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt }, // 使用动态生成的提示词
                            {
                                type: "image_url",
                                image_url: {
                                    url: imageData,
                                },
                            },
                        ],
                    },
                ],
            });

            return response.text.trim();
        } catch (error: any) {
            this.ctx.logger.error("表情分类失败", error);
            return "分类失败";
        }
    }

    /**
     * 从外部文件夹导入表情包
     * @param sourceDir 源文件夹路径
     * @param session 会话对象（用于日志记录）
     * @returns 导入结果统计信息
     */
    public async importFromDirectory(sourceDir: string, session: Session): Promise<ImportStats> {
        // 初始化统计数据
        const stats: ImportStats = {
            total: 0,
            success: 0,
            failed: 0,
            skipped: 0,
            failedFiles: [],
        };

        // 检查源目录是否存在
        if (!(await this.dirExists(sourceDir))) {
            throw new Error(`源目录不存在: ${sourceDir}`);
        }

        // 创建进度消息
        const progressMsg = await session.sendQueued("开始导入表情包，正在扫描目录...");

        try {
            // 获取所有子目录（每个目录作为一个分类）
            const subdirs = await this.getValidSubdirectories(sourceDir);

            for (const [index, subdir] of subdirs.entries()) {
                // 更新进度

                const category = path.basename(subdir);
                const files = await this.getImageFiles(subdir);
                stats.total += files.length;

                // 导入当前分类下的所有图片
                for (const file of files) {
                    try {
                        const filePath = path.join(subdir, file);
                        const result = await this.importSingleSticker(filePath, category);

                        if (result === "success") {
                            stats.success++;
                        } else {
                            stats.skipped++;
                        }
                    } catch (error: any) {
                        stats.failed++;
                        stats.failedFiles.push(file);
                        this.ctx.logger.warn(`导入失败: ${file} - ${error.message}`);
                    }
                }
            }
        } finally {
            // 移除进度消息
        }

        return stats;
    }

    /** 获取有效的子目录列表 */
    private async getValidSubdirectories(dir: string): Promise<string[]> {
        const items = await readdir(dir, { withFileTypes: true });
        return items.filter((item) => item.isDirectory()).map((item) => path.join(dir, item.name));
    }

    /** 获取目录下的所有图片文件 */
    private async getImageFiles(dir: string): Promise<string[]> {
        const items = await readdir(dir, { withFileTypes: true });
        return items.filter((item) => item.isFile() && this.isValidImageType(item.name)).map((item) => item.name);
    }

    /** 校验文件类型 */
    private isValidImageType(fileName: string): boolean {
        const ext = path.extname(fileName).toLowerCase().slice(1);
        return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
    }

    /** 计算文件哈希值 */
    private async calculateFileHash(filePath: string): Promise<string> {
        const buffer = await readFile(filePath);
        const hash = createHash("sha256");
        hash.update(buffer);
        return hash.digest("hex");
    }

    private async saveImageToLocal(url: string, content: ArrayBuffer, contentType: string): Promise<{ localPath: string }> {
        const id = createHash("sha256").update(url).digest("hex");
        const extension = contentType.split("/")[1] || "bin";
        const fileName = `${id}.${extension}`;
        const filePath = path.join(this.config.storagePath, fileName);

        await writeFile(filePath, Buffer.from(content));
        return { localPath: filePath };
    }

    /**
     * 规范化 emojihub-bili URL
     * 处理特定格式的部分 URL
     */
    private normalizeEmojiHubUrl(rawUrl: string): string {
        // 1. 完整的 URL 直接返回
        if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
            return rawUrl;
        }

        // 2. 处理特定前缀问题 (如重复的 "https:")
        if (rawUrl.startsWith("https:https://")) {
            return rawUrl.replace("https:", "");
        }

        // 3. 添加 B 站默认前缀
        if (rawUrl.startsWith("bfs/") || rawUrl.startsWith("/bfs/")) {
            return `https://i0.hdslb.com/${rawUrl.replace(/^\//, "")}`;
        }

        // 4. 添加 Koishi Meme 默认前缀
        if (rawUrl.startsWith("meme/") || rawUrl.startsWith("/meme/")) {
            return `https://memes.none.bot/${rawUrl.replace(/^\//, "")}`;
        }

        // 5. 其他情况视为相对路径
        return `https://i0.hdslb.com/bfs/${rawUrl}`;
    }

    /** 检查目录是否存在 */
    private async dirExists(dir: string): Promise<boolean> {
        try {
            await readdir(dir);
            return true;
        } catch {
            return false;
        }
    }

    async getCategories(): Promise<string[]> {
        const records = await this.ctx.database.select(TableName).execute();

        return [...new Set(records.map((r) => r.category))];
    }

    async getRandomSticker(category: string): Promise<h> {
        const records = await this.ctx.database.select(TableName).where({ category }).execute();

        if (records.length === 0)
            return null;

        const randomIndex = Math.floor(Math.random() * records.length);
        const sticker = records[randomIndex];

        const fileUrl = pathToFileURL(sticker.filePath).href;

        const ext = sticker.filePath.split(".").pop();

        const b64 = await readFile(sticker.filePath, "base64");
        const base64Data = `data:image/${ext};base64,${b64}`;

        return h.image(base64Data, { "sub-type": "1" });
    }

    async getStickersByCategory(category: string): Promise<StickerRecord[]> {
        const records = await this.ctx.database.select(TableName).where({ category }).execute();

        if (records.length === 0)
            return [];

        return records;
    }

    public async importEmojiHubTxt(filePath: string, category: string, session: Session): Promise<ImportStats> {
        const stats: ImportStats = {
            total: 0,
            success: 0,
            failed: 0,
            skipped: 0,
            failedUrls: [],
        };

        // 读取 TXT 文件
        let urls: string[];
        try {
            const content = await readFile(filePath, "utf-8");
            urls = content
                .split("\n")
                .map((url) => url.trim())
                .filter((url) => url.length > 0);
        } catch (error: any) {
            throw new Error(`无法读取文件: ${error.message}`);
        }

        stats.total = urls.length;
        if (stats.total === 0) {
            throw new Error("文件为空或没有有效的 URL");
        }

        // 创建进度消息
        const progressMsg = await session.sendQueued(`开始导入表情包，共 ${stats.total} 个 URL...`);

        try {
            // 准备临时下载目录
            const tempDir = path.join(this.config.storagePath, "temp");
            await mkdir(tempDir, { recursive: true });
            this.ctx.logger.debug(`创建临时目录: ${tempDir}`);

            // 处理每个 URL
            for (const [index, rawUrl] of urls.entries()) {
                // 更新进度消息
                if (index % 100 === 0 && progressMsg) {
                    await session.sendQueued(`已处理 ${index}/${urls.length} 个 URL...`);
                }

                try {
                    // 规范化 URL
                    const url = this.normalizeEmojiHubUrl(rawUrl);

                    // 使用 fetch API 下载图片
                    const response = await this.fetchWithTimeout(url, 15000);

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status} ${response.statusText}`);
                    }

                    // 获取内容类型
                    const contentType = response.headers.get("content-type") || "image/jpeg";

                    // 获取文件扩展名
                    const extension = this.getExtensionFromContentType(contentType) || "bin";

                    // 生成文件名 (使用URL哈希)
                    const fileHash = createHash("sha256").update(url).digest("hex");
                    const tempFilePath = path.join(this.config.storagePath, `${fileHash}.${extension}`);

                    // 将图片数据写入文件
                    const buffer = await response.arrayBuffer();
                    await writeFile(tempFilePath, Buffer.from(buffer));
                    this.ctx.logger.debug(`已下载图片: ${tempFilePath}`);

                    // 使用 importSingleSticker 方法导入
                    const result = await this.importSingleSticker(tempFilePath, category, session);

                    if (result === "success") {
                        stats.success++;
                    } else if (result === "duplicate") {
                        stats.skipped++;

                        // 清理重复文件
                        try {
                            await unlink(tempFilePath);
                        } catch (cleanupError) {
                            this.ctx.logger.warn(`清理临时文件失败: ${tempFilePath}`, cleanupError);
                        }
                    }
                } catch (error: any) {
                    stats.failed++;
                    stats.failedUrls.push({ url: rawUrl, error: error.message });
                    this.ctx.logger.warn(`导入失败: ${rawUrl} - ${error.message}`);
                }
            }
        } finally {
            // 移除进度消息
            if (progressMsg) {
                // await session.cancelQueued(progressMsg);
            }

            // await this.cleanupTempDir(tempDir);
        }

        return stats;
    }

    /**
     * 根据Content-Type获取文件扩展名
     */
    private getExtensionFromContentType(contentType: string): string | null {
        const mimeMap: Record<string, string> = {
            "image/jpeg": "jpg",
            "image/jpg": "jpg",
            "image/png": "png",
            "image/gif": "gif",
            "image/webp": "webp",
            "image/svg+xml": "svg",
            "image/bmp": "bmp",
        };

        // 移除参数部分（如 charset）
        const cleanType = contentType.split(";")[0].trim().toLowerCase();
        return mimeMap[cleanType] || null;
    }

    /**
     * 自定义 fetch 方法，带超时控制
     */
    private async fetchWithTimeout(url: string, timeout: number): Promise<Response> {
        return new Promise((resolve, reject) => {
            // 设置超时定时器
            const timeoutId = setTimeout(() => {
                reject(new Error("请求超时"));
            }, timeout);

            // 发起 fetch 请求
            fetch(url)
                .then((response) => {
                    clearTimeout(timeoutId);
                    resolve(response);
                })
                .catch((error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }

    /**
     * 清理临时目录
     */
    private async cleanupTempDir(tempDir: string) {
        try {
            const files = await readdir(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                await unlink(filePath);
            }
            await rmdir(tempDir);
            this.ctx.logger.debug(`已清理临时目录: ${tempDir}`);
        } catch (error: any) {
            this.ctx.logger.warn(`清理临时目录失败: ${error.message}`);
        }
    }

    /**
     * 增强版 importSingleSticker 方法
     */
    private async importSingleSticker(filePath: string, category: string, session?: Session): Promise<"success" | "duplicate"> {
        // 校验文件类型
        if (!this.isValidImageFile(filePath)) {
            throw new Error("不支持的文件类型");
        }

        // 检查文件是否已存在
        const fileHash = await this.calculateFileHash(filePath);
        const existing = await this.ctx.database.get(TableName, { id: fileHash });
        if (existing.length > 0) {
            return "duplicate";
        }

        // 获取文件扩展名
        const extension = path.extname(filePath) || ".png";

        // 目标文件路径
        const destPath = path.resolve(this.config.storagePath, `${fileHash}${extension}`);

        // 移动文件到表情包目录
        await rename(filePath, destPath);

        // 创建数据库记录
        const record: StickerRecord = {
            id: fileHash,
            category,
            filePath: destPath,
            source: {
                platform: session?.platform || "import",
                channelId: session?.channelId || "",
                userId: session?.userId || "",
                messageId: session?.messageId || "",
            },
            createdAt: new Date(),
        };

        await this.ctx.database.create(TableName, record);
        this.ctx.logger.info(`已导入表情: ${category}/${fileHash}${extension}`);

        return "success";
    }

    /**
     * 增强版文件类型验证
     */
    private isValidImageFile(filePath: string): boolean {
        try {
            const extension = path.extname(filePath).toLowerCase().slice(1);
            return ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(extension);
        } catch {
            return false;
        }
    }

    public async renameCategory(oldName: string, newName: string): Promise<number> {
        const result = await this.ctx.database.set(TableName, { category: oldName }, { category: newName });
        const modified = result.matched;
        this.ctx.logger.info(`已将分类 "${oldName}" 重命名为 "${newName}"，更新了 ${modified} 个表情包`);
        return modified;
    }

    public async deleteCategory(category: string): Promise<number> {
        // 获取该分类的所有表情包
        const stickers = await this.ctx.database.get(TableName, {
            category: { $eq: category },
        });

        // 删除数据库记录
        const result = await this.ctx.database.remove(TableName, { category });

        // 删除文件
        for (const sticker of stickers) {
            try {
                await unlink(sticker.filePath);
                this.ctx.logger.debug(`已删除表情包文件: ${sticker.filePath}`);
            } catch (error: any) {
                this.ctx.logger.warn(`删除文件失败: ${sticker.filePath}`, error);
            }
        }

        this.ctx.logger.info(`已删除分类 "${category}"，共移除 ${result.removed} 个表情包`);
        return result.removed;
    }

    /**
     * 合并两个分类
     */
    public async mergeCategories(sourceCategory: string, targetCategory: string): Promise<number> {
        const result = await this.ctx.database.set(TableName, { category: sourceCategory }, { category: targetCategory });

        this.ctx.logger.info(`已将分类 "${sourceCategory}" 合并到 "${targetCategory}"，移动了 ${result.modified} 个表情包`);
        return result.modified;
    }

    /**
     * 移动表情包到新分类
     */
    public async moveSticker(stickerId: string, newCategory: string): Promise<number> {
        const result = await this.ctx.database.set(TableName, { id: stickerId }, { category: newCategory });

        if (result.modified === 0) {
            throw new Error("未找到该表情包");
        }

        this.ctx.logger.info(`已将表情包 ${stickerId} 移动到分类 "${newCategory}"`);
        return result.modified;
    }

    /**
     * 获取分类中的表情包数量
     */
    public async getStickerCount(category: string): Promise<number> {
        const result = await this.ctx.database.get(TableName, {
            category: { $eq: category },
        });

        return result.length;
    }

    /**
     * 获取指定表情包
     */
    public async getSticker(stickerId: string): Promise<StickerRecord | null> {
        const result = await this.ctx.database.get(TableName, { id: stickerId });
        return result.length > 0 ? result[0] : null;
    }

    /**
     * 清理未使用的表情包
     */
    public async cleanupUnreferenced(): Promise<number> {
        const dbFiles = new Set((await this.ctx.database.select(TableName).execute()).map((r) => path.basename(r.filePath)));
        const fsFiles = await readdir(this.config.storagePath);

        let deletedCount = 0;
        for (const file of fsFiles) {
            if (!dbFiles.has(file)) {
                try {
                    await unlink(path.join(this.config.storagePath, file));
                    this.ctx.logger.debug(`清理未引用表情: ${file}`);
                    deletedCount++;
                } catch (error: any) {
                    this.ctx.logger.warn(`清理失败: ${file}`, error);
                }
            }
        }

        return deletedCount;
    }
}
