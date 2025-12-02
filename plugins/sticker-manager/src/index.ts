import type { Context } from "koishi";
import type { AssetService } from "koishi-plugin-yesimbot/services";
import type { FunctionContext } from "koishi-plugin-yesimbot/services/plugin";
import type { StickerConfig } from "./config";
import { readFile } from "node:fs/promises";
import { h, Schema } from "koishi";
import { Action, Failed, Metadata, Plugin, requireSession, Success } from "koishi-plugin-yesimbot/services/plugin";
import { Services } from "koishi-plugin-yesimbot/shared";
import { StickerService } from "./service";

@Metadata({
    name: "sticker-manager",
    display: "表情包管理",
    description: "用于偷取和发送表情包",
})
export default class StickerTools extends Plugin<StickerConfig> {
    static readonly inject = ["database", Services.Asset, Services.Model, Services.Prompt, Services.Plugin];

    static readonly Config: Schema<StickerConfig> = Schema.object({
        storagePath: Schema.path({ allowCreate: true, filters: ["directory"] })
            .default("data/yesimbot/sticker")
            .description("表情包存储路径"),
        classifiModel: Schema.dynamic("modelService.selectableModels").description("用于表情分类的多模态模型"),
        classificationPrompt: Schema.string()
            .role("textarea", { rows: [2, 4] })
            .default(
                "请对以下表情包进行分类，已有分类：[{{categories}}]。选择最匹配的分类或创建新类别。只返回分类名称。分类应基于可能的使用语境（例如：工作、休闲、节日），避免模糊不清的名称（如“表情包”）。尽可能详细分类（如“庆祝成功”而非“快乐”）。若不确定，请思考此表情包的具体使用场景（例如：我应该在什么时候用它？）来帮助确定。",
            )
            .description("多模态分类提示词模板，可使用 {{categories}} 占位符动态插入分类列表"),
    });

    private assetService: AssetService;
    private stickerService: StickerService;

    private static serviceInstance: StickerService | null = null;

    constructor(ctx: Context, config: StickerConfig) {
        super(ctx, config);
        // 确保只创建一个服务实例
        if (!StickerTools.serviceInstance) {
            StickerTools.serviceInstance = new StickerService(ctx, config);
        }

        this.assetService = ctx[Services.Asset];
        this.stickerService = StickerTools.serviceInstance;

        ctx.on("ready", async () => {
            // 等待服务完全启动
            await this.stickerService.whenReady();

            try {
                // 确保只初始化一次
                if (!this.initialized) {
                    this.initialized = true;
                    this.ctx.logger.info("插件已成功启动");
                }
            } catch (error: any) {
                this.ctx.logger.warn("插件初始化失败！");
                this.ctx.logger.error(error);
            }
        });

        const cmd = ctx.command("sticker", "表情包管理相关指令", { authority: 3 });

        cmd.subcommand(
            ".import <sourceDir>",
            "从外部文件夹导入表情包。该文件夹须包含若干子文件夹作为分类，子文件夹下是表情包的图片文件。",
        )
            .option("force", "-f  强制覆盖已存在的表情包")
            .action(async ({ session, options }, sourceDir) => {
                if (!sourceDir)
                    return "请指定源文件夹路径";

                try {
                    const stats = await this.stickerService.importFromDirectory(sourceDir, session);

                    // 准备结果消息
                    let message = `导入完成!\n`;
                    message += `✅ 总数: ${stats.total}\n`;
                    message += `✅ 成功导入: ${stats.success}\n`;
                    message += `⚠️ 跳过重复: ${stats.skipped}\n`;
                    message += `❌ 失败: ${stats.failed}\n`;

                    // 添加失败文件列表
                    if (stats.failedFiles.length > 0) {
                        message += `\n失败文件列表:\n${stats.failedFiles.slice(0, 10).join("\n")}`;
                        if (stats.failedFiles.length > 10) {
                            message += `\n...等 ${stats.failedFiles.length} 个文件`;
                        }
                    }

                    return message;
                } catch (error: any) {
                    return `导入失败: ${error.message}`;
                }
            });

        cmd.subcommand(".import.emojihub <category> <filePath>", "导入 emojihub-bili 格式的 TXT 文件")
            .option("prefix", "-p [prefix:string] 自定义 URL 前缀")
            .action(async ({ session, options }, category, filePath) => {
                if (!category)
                    return "请指定分类名称";
                if (!filePath)
                    return "请指定 TXT 文件路径";

                try {
                    const stats = await this.stickerService.importEmojiHubTxt(filePath, category, session);

                    // 准备结果消息
                    let message = `导入完成!\n`;
                    message += `📁 分类: ${category}\n`;
                    message += `📝 文件: ${filePath}\n`;
                    message += `✅ 总数: ${stats.total}\n`;
                    message += `✅ 成功导入: ${stats.success}\n`;
                    message += `❌ 失败: ${stats.failed}\n`;

                    // 添加失败 URL 列表
                    if (stats.failedUrls.length > 0) {
                        message += `\n失败 URL 列表:\n`;
                        stats.failedUrls.slice(0, 5).forEach((item, index) => {
                            message += `${index + 1}. ${item.url} (${item.error})\n`;
                        });
                        if (stats.failedUrls.length > 5) {
                            message += `...等 ${stats.failedUrls.length} 个失败项`;
                        }
                    }

                    return message;
                } catch (error: any) {
                    return `导入失败: ${error.message}`;
                }
            });

        cmd.subcommand(".list", "列出表情包分类")
            .alias("表情分类")
            .action(async ({ session }) => {
                const categories = await this.stickerService.getCategories();
                if (categories.length === 0) {
                    return "暂无表情包分类";
                }

                const categoryWithCounts = await Promise.all(
                    categories.map(async (c) => {
                        const count = await this.stickerService.getStickerCount(c);
                        return `- ${c} (${count} 个表情包)`;
                    }),
                );

                return `📁 表情包分类列表:\n${categoryWithCounts.join("\n")}`;
            });

        cmd.subcommand(".rename <oldName> <newName>", "重命名表情包分类")
            .alias("表情重命名")
            .action(async ({ session }, oldName, newName) => {
                if (!oldName || !newName)
                    return "请提供原分类名和新分类名";
                if (oldName === newName)
                    return "新分类名不能与原分类名相同";

                try {
                    const count = await this.stickerService.renameCategory(oldName, newName);

                    return `✅ 已将分类 "${oldName}" 重命名为 "${newName}"，共更新 ${count} 个表情包`;
                } catch (error: any) {
                    return `❌ 重命名失败: ${error.message}`;
                }
            });

        cmd.subcommand(".delete <category>", "删除表情包分类")
            .alias("删除分类")
            .option("force", "-f 强制删除，不确认")
            .action(async ({ session, options }, category) => {
                if (!category)
                    return "请提供要删除的分类名";

                // 获取分类中的表情包数量
                const count = await this.stickerService.getStickerCount(category);
                if (count === 0) {
                    return `分类 "${category}" 中没有任何表情包`;
                }

                // 非强制模式需要确认
                if (!options.force) {
                    const messageId = await session.sendQueued(
                        `⚠️ 确定要删除分类 "${category}" 吗？该分类下有 ${count} 个表情包！\n`
                        + `回复 "确认删除" 来确认操作，或回复 "取消" 取消操作。`,
                    );

                    const response = await session.prompt(60000); // 60秒等待
                    if (response !== "确认删除") {
                        return "操作已取消";
                    }
                }

                try {
                    const deletedCount = await this.stickerService.deleteCategory(category);

                    return `✅ 已删除分类 "${category}"，共移除 ${deletedCount} 个表情包`;
                } catch (error: any) {
                    return `❌ 删除失败: ${error.message}`;
                }
            });

        cmd.subcommand(".merge <sourceCategory> <targetCategory>", "合并两个表情包分类")
            .alias("合并分类")
            .action(async ({ session }, sourceCategory, targetCategory) => {
                if (!sourceCategory || !targetCategory)
                    return "请提供源分类和目标分类";
                if (sourceCategory === targetCategory)
                    return "源分类和目标分类不能相同";

                try {
                    const movedCount = await this.stickerService.mergeCategories(sourceCategory, targetCategory);

                    return `✅ 已将分类 "${sourceCategory}" 合并到 "${targetCategory}"，共移动 ${movedCount} 个表情包`;
                } catch (error: any) {
                    return `❌ 合并失败: ${error.message}`;
                }
            });

        cmd.subcommand(".move <stickerId> <newCategory>", "移动表情包到新分类")
            .alias("移动表情")
            .action(async ({ session }, stickerId, newCategory) => {
                if (!stickerId || !newCategory)
                    return "请提供表情包ID和目标分类";

                try {
                    await this.stickerService.moveSticker(stickerId, newCategory);
                    return `✅ 已将表情包 ${stickerId} 移动到分类 "${newCategory}"`;
                } catch (error: any) {
                    return `❌ 移动失败: ${error.message}`;
                }
            });

        cmd.subcommand(".get <category> [index:posint]", "获取指定分类的表情包")
            .option("all", "-a 发送该分类下所有表情包")
            .option("delay", "-d [delay:posint] 发送所有表情包时的延时 (毫秒), 默认为 500 毫秒")
            .action(async ({ session, options }, category, index) => {
                if (!category)
                    return "请提供分类名称";

                // 获取分类下所有表情包
                const stickers = await this.stickerService.getStickersByCategory(category);
                if (!stickers.length)
                    return `分类 "${category}" 中没有表情包`;

                // 处理索引或随机选择
                let targetSticker;
                if (options.all) {
                    // 发送所有表情包
                    const delay = options.delay || 500; // 默认延时 500 毫秒
                    for (const sticker of stickers) {
                        const ext = sticker.filePath.split(".").pop();
                        const b64 = await readFile(sticker.filePath, "base64");
                        const base64Data = `data:image/${ext};base64,${b64}`;
                        await session.sendQueued(h.image(base64Data));
                        await new Promise((resolve) => setTimeout(resolve, delay)); // 延时
                    }
                    return `✅ 已发送分类 "${category}" 下所有 ${stickers.length} 个表情包。`;
                } else if (index) {
                    targetSticker = stickers[index - 1];
                    if (!targetSticker)
                        return `无效序号，该分类共有 ${stickers.length} 个表情包`;
                } else {
                    targetSticker = stickers[Math.floor(Math.random() * stickers.length)];
                }

                // 发送表情包
                const ext = targetSticker.filePath.split(".").pop();
                const b64 = await readFile(targetSticker.filePath, "base64");
                const base64Data = `data:image/${ext};base64,${b64}`;

                await session.sendQueued(h.image(base64Data));
                return `🆔 ID: ${targetSticker.id}\n📁 分类: ${category}`;
            });

        cmd.subcommand(".info <category>", "查看分类详情").action(async ({ session }, category) => {
            const stickers = await this.stickerService.getStickersByCategory(category);
            if (!stickers.length)
                return `分类 "${category}" 中没有表情包`;

            return `📁 分类: ${category}
📊 数量: ${stickers.length}
🕒 最新: ${stickers[0].createdAt.toLocaleDateString()}
👆 使用: sticker.get ${category} [1-${stickers.length}]`;
        });

        cmd.subcommand(".cleanup", "清理未使用的表情包")
            .alias("清理表情")
            .action(async ({ session }) => {
                try {
                    const deletedCount = await this.stickerService.cleanupUnreferenced();

                    return `✅ 已清理 ${deletedCount} 个未使用的表情包`;
                } catch (error: any) {
                    return `❌ 清理失败: ${error.message}`;
                }
            });
    }

    private initialized = false;

    @Action({
        name: "steal_sticker",
        description:
            "收藏一个表情包。当用户发送表情包时，调用此工具将表情包保存到本地并分类。分类后你也可以使用这些表情包。",
        parameters: Schema.object({
            image_id: Schema.string().required().description("要偷取的表情图片ID"),
        }),
        activators: [requireSession()],
    })
    async stealSticker(params: { image_id: string }, context: FunctionContext) {
        const { image_id } = params;
        const session = context.session;
        try {
            // 需要两份图片数据
            // 经过处理的，静态的图片供LLM分析
            // 原始图片供保存和发送
            // 这里直接传入图片ID
            const record = await this.stickerService.stealSticker(image_id, session);

            return Success({
                id: record.id,
                category: record.category,
                message: `已偷取表情包到分类: ${record.category}`,
            });
        } catch (error: any) {
            return Failed(`偷取失败: ${error.message}`);
        }
    }

    @Action({
        name: "send_sticker",
        description: "发送一个表情包，用于辅助表达情感，结合语境酌情使用。",
        parameters: Schema.object({
            category: Schema.string().required().description("表情包分类名称。当前可用分类: {{ sticker.categories }}"),
        }),
        activators: [requireSession()],
    })
    async sendRandomSticker(params: { category: string }, context: FunctionContext) {
        const { category } = params;
        const session = context.session;
        try {
            const sticker = await this.stickerService.getRandomSticker(category);

            if (!sticker)
                return Failed(`分类 "${category}" 中没有表情包`);

            await session.sendQueued(sticker);

            return Success({
                message: `已发送 ${category} 分类的表情包`,
            });
        } catch (error: any) {
            return Failed(`发送失败: ${error.message}`);
        }
    }
}
