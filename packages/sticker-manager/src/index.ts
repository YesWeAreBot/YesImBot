import { readFile } from "fs/promises";
import { Context, Schema, Session, h } from "koishi";
import { AssetService, Extension, Failed, Infer, ModelDescriptor, PromptService, Success, Tool } from "koishi-plugin-yesimbot/services";
import { Services } from "koishi-plugin-yesimbot/shared";
import { pathToFileURL } from "url";
import { StickerService } from "./service";
export interface StickerConfig {
    storagePath: string;
    classifiModel: ModelDescriptor;
    classificationPrompt: string;
}

@Extension({
    name: "sticker-manager",
    display: "表情包管理",
    description: "用于偷取和发送表情包",
    author: "HydroGest",
    version: "1.0.0",
})
export default class StickerTools {
    static readonly inject = ["database", Services.Asset, Services.Model, Services.Prompt, Services.Tool];

    static readonly Config: Schema<StickerConfig> = Schema.object({
        storagePath: Schema.path({ allowCreate: true, filters: ["directory"] })
            .default("data/yesimbot/sticker")
            .description("表情包存储路径"),
        classifiModel: Schema.dynamic("modelService.selectableModels").description("用于表情分类的多模态模型"),
        classificationPrompt: Schema.string()
            .role("textarea", { rows: [2, 4] })
            .default(
                "请对以下表情包进行分类，已有分类：[{{categories}}]。选择最匹配的分类或创建新类别。只返回分类名称。分类应基于可能的使用语境（例如：工作、休闲、节日），避免模糊不清的名称（如“表情包”）。尽可能详细分类（如“庆祝成功”而非“快乐”）。若不确定，请思考此表情包的具体使用场景（例如：我应该在什么时候用它？）来帮助确定。"
            )
            .description("多模态分类提示词模板，可使用 {{categories}} 占位符动态插入分类列表"),
    });

    private assetService: AssetService;
    private stickerService: StickerService;

    private static serviceInstance: StickerService | null = null;

    constructor(
        public ctx: Context,
        public config: StickerConfig
    ) {
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
                    this.stickerService.logger.info("插件已成功启动");

                    this.registerSnippets();
                }
            } catch (error) {
                this.stickerService.logger.warn("插件初始化失败！");
                this.stickerService.logger.error(error);
            }
        });

        ctx.command("sticker.import.emojihub <category> <filePath>", "导入 emojihub-bili 格式的 TXT 文件", { authority: 3 })
            .option("prefix", "-p [prefix:string] 自定义 URL 前缀")
            .action(async ({ session, options }, category, filePath) => {
                if (!category) return "请指定分类名称";
                if (!filePath) return "请指定 TXT 文件路径";

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
                } catch (error) {
                    return `导入失败: ${error.message}`;
                }
            });

        ctx.command(
            "sticker.import <sourceDir>",
            "从外部文件夹导入表情包。该文件夹须包含若干子文件夹作为分类，子文件夹下是表情包的图片文件。",
            { authority: 3 }
        )
            .option("force", "-f  强制覆盖已存在的表情包")
            .action(async ({ session, options }, sourceDir) => {
                if (!sourceDir) return "请指定源文件夹路径";

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
                } catch (error) {
                    return `导入失败: ${error.message}`;
                }
            });

        ctx.command("sticker.list", "列出表情包分类", { authority: 3 }).alias("表情分类").action(async ({ session }) => {
          const categories = await this.stickerService.getCategories();
          if (categories.length === 0) {
            return "暂无表情包分类";
          }
        
          // 1. 创建一个 promises 数组
          //    我们使用 map 来遍历每个分类，并为每个分类创建一个异步任务，用于获取其数量
          const categoryWithCountPromises = categories.map(async (category) => {
            const count = await this.stickerService.getStickerCount(category);
            return `- ${category} (${count}个)`; // 返回我们想要的最终格式
          });
        
          // 2. 等待所有异步任务完成
          //    Promise.all 会等待数组中所有的 promise 都完成后，返回一个包含所有结果的新数组
          const formattedCategories = await Promise.all(categoryWithCountPromises);
        
          // 3. 将格式化后的所有行合并成一个字符串并返回
          return `📁 表情包分类列表:
        ${formattedCategories.join("\n")}`;
        });

        ctx.command("sticker.rename <oldName> <newName>", "重命名表情包分类", { authority: 3 })
            .alias("表情重命名")
            .action(async ({ session }, oldName, newName) => {
                if (!oldName || !newName) return "请提供原分类名和新分类名";
                if (oldName === newName) return "新分类名不能与原分类名相同";

                try {
                    const count = await this.stickerService.renameCategory(oldName, newName);

                    return `✅ 已将分类 "${oldName}" 重命名为 "${newName}"，共更新 ${count} 个表情包`;
                } catch (error) {
                    return `❌ 重命名失败: ${error.message}`;
                }
            });

        ctx.command("sticker.delete <category>", "删除表情包分类", { authority: 3 })
            .alias("删除分类")
            .option("force", "-f 强制删除，不确认")
            .action(async ({ session, options }, category) => {
                if (!category) return "请提供要删除的分类名";

                // 获取分类中的表情包数量
                const count = await this.stickerService.getStickerCount(category);
                if (count === 0) {
                    return `分类 "${category}" 中没有任何表情包`;
                }

                // 非强制模式需要确认
                if (!options.force) {
                    const messageId = await session.sendQueued(
                        `⚠️ 确定要删除分类 "${category}" 吗？该分类下有 ${count} 个表情包！\n` +
                            `回复 "确认删除" 来确认操作，或回复 "取消" 取消操作。`
                    );

                    const response = await session.prompt(60000); // 60秒等待
                    if (response !== "确认删除") {
                        return "操作已取消";
                    }
                }

                try {
                    const deletedCount = await this.stickerService.deleteCategory(category);

                    return `✅ 已删除分类 "${category}"，共移除 ${deletedCount} 个表情包`;
                } catch (error) {
                    return `❌ 删除失败: ${error.message}`;
                }
            });

        ctx.command("sticker.merge <sourceCategory> <targetCategory>", "合并两个表情包分类", { authority: 3 })
            .alias("合并分类")
            .action(async ({ session }, sourceCategory, targetCategory) => {
                if (!sourceCategory || !targetCategory) return "请提供源分类和目标分类";
                if (sourceCategory === targetCategory) return "源分类和目标分类不能相同";

                try {
                    const movedCount = await this.stickerService.mergeCategories(sourceCategory, targetCategory);

                    return `✅ 已将分类 "${sourceCategory}" 合并到 "${targetCategory}"，共移动 ${movedCount} 个表情包`;
                } catch (error) {
                    return `❌ 合并失败: ${error.message}`;
                }
            });

        ctx.command("sticker.move <stickerId> <newCategory>", "移动表情包到新分类", { authority: 3 })
            .alias("移动表情")
            .action(async ({ session }, stickerId, newCategory) => {
                if (!stickerId || !newCategory) return "请提供表情包ID和目标分类";

                try {
                    await this.stickerService.moveSticker(stickerId, newCategory);
                    return `✅ 已将表情包 ${stickerId} 移动到分类 "${newCategory}"`;
                } catch (error) {
                    return `❌ 移动失败: ${error.message}`;
                }
            });

        ctx.command("sticker.get <category> [index]", "获取指定分类的表情包").action(async ({ session }, category, index) => {
          if (!category) return "请提供分类名称";
          const stickers = await this.stickerService.getStickersByCategory(category);
          if (!stickers.length) return `分类 "${category}" 中没有表情包`;
        
          // --- 新增逻辑：处理 'all' 参数 ---
          if (index === 'all') {
            await session.sendQueued(`即将按顺序发送分类 "${category}" 下的所有 ${stickers.length} 个表情包...`);
            // 使用 for 循环来确保按顺序发送并可以添加延时
            for (let i = 0; i < stickers.length; i++) {
              const sticker = stickers[i];
              const ext = sticker.filePath.split(".").pop();
              try {
                const b64 = await (0, import_promises.readFile)(sticker.filePath, "base64");
                const base64Data = `data:image/${ext};base64,${b64}`;
                await session.sendQueued(import_koishi.h.image(base64Data));
                await session.sendQueued(`[${i + 1}/${stickers.length}] 🆔 ID: ${sticker.id}`);
                // 添加一个 500 毫秒的延时，防止发送过快
                await new Promise(res => setTimeout(res, 500));
              } catch (error) {
                this.stickerService.logger.warn(`无法读取或发送表情文件: ${sticker.filePath}`, error);
                await session.sendQueued(`❌ 发送第 ${i + 1} 个表情失败，文件可能已损坏或被移动。`);
              }
            }
            return `✅ 已发送完毕。`;
          }
          // --- 新增逻辑结束 ---
        
          // --- 保留原有逻辑 ---
          let targetSticker;
          if (index) {
            const numericIndex = parseInt(index, 10);
            // 检查是否为有效数字
            if (isNaN(numericIndex)) {
                return `无效的序号 "${index}"。请提供一个数字，或使用 "all" 获取全部。`;
            }
            targetSticker = stickers[numericIndex - 1];
            if (!targetSticker) return `无效序号，该分类共有 ${stickers.length} 个表情包`;
          } else {
            targetSticker = stickers[Math.floor(Math.random() * stickers.length)];
          }
        
          try {
            const ext = targetSticker.filePath.split(".").pop();
            const b64 = await (0, import_promises.readFile)(targetSticker.filePath, "base64");
            const base64Data = `data:image/${ext};base64,${b64}`;
            await session.sendQueued(import_koishi.h.image(base64Data));
            return `🆔 ID: ${targetSticker.id}
        📁 分类: ${category}`;
          } catch (error) {
            this.stickerService.logger.warn(`无法读取或发送表情文件: ${targetSticker.filePath}`, error);
            return `❌ 发送表情失败，文件可能已损坏或被移动。`;
          }
        });

        ctx.command("sticker.info <category>", "查看分类详情", { authority: 3 }).action(async ({ session }, category) => {
            const stickers = await this.stickerService.getStickersByCategory(category);
            if (!stickers.length) return `分类 "${category}" 中没有表情包`;

            return `📁 分类: ${category}
📊 数量: ${stickers.length}
🕒 最新: ${stickers[0].createdAt.toLocaleDateString()}
👆 使用: sticker.get ${category} [1-${stickers.length}]`;
        });

        ctx.command("sticker.cleanup", "清理未使用的表情包")
            .alias("清理表情")
            .action(async ({ session }) => {
                try {
                    const deletedCount = await this.stickerService.cleanupUnreferenced();

                    return `✅ 已清理 ${deletedCount} 个未使用的表情包`;
                } catch (error) {
                    return `❌ 清理失败: ${error.message}`;
                }
            });
    }

    private initialized = false;

    private registerSnippets() {
        const promptService: PromptService = this.ctx[Services.Prompt];

        promptService.registerSnippet("sticker.categories", async () => {
            const categories = await this.stickerService.getCategories();
            return categories.join(", ") || "暂无分类，请先收藏表情包";
        });
    }

    @Tool({
        name: "steal_sticker",
        description: "收藏一个表情包。当用户发送表情包时，调用此工具将表情包保存到本地并分类。分类后你也可以使用这些表情包。",
        parameters: Schema.object({
            image_id: Schema.string().required().description("要偷取的表情图片ID"),
        }),
    })
    async stealSticker({ image_id, session }: Infer<{ image_id: string }> & { session: Session }) {
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
        } catch (error) {
            return Failed(`偷取失败: ${error.message}`);
        }
    }

    @Tool({
        name: "send_sticker",
        description: "发送一个表情包，用于辅助表达情感，结合语境酌情使用。",
        parameters: Schema.object({
            category: Schema.string().required().description("表情包分类名称。当前可用分类: {{ sticker.categories }}"),
        }),
    })
    async sendRandomSticker({ session, category }: Infer<{ category: string }>) {
        try {
            const sticker = await this.stickerService.getRandomSticker(category);

            if (!sticker) return Failed(`分类 "${category}" 中没有表情包`);

            await session.sendQueued(sticker);

            return Success({
                message: `已发送 ${category} 分类的表情包`,
            });
        } catch (error) {
            return Failed(`发送失败: ${error.message}`);
        }
    }
}
