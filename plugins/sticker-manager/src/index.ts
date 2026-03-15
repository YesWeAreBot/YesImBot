import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { Context, Schema, Session, h } from "koishi";
import type { ModelService } from "koishi-plugin-yesimbot/services/model";
import {
  Action,
  Failed,
  Metadata,
  Success,
  Tool,
  type ToolExecutionContext,
  YesImPlugin,
  withInnerThoughts,
} from "koishi-plugin-yesimbot/services/plugin";
import type { PromptFragment, PromptService } from "koishi-plugin-yesimbot/services/prompt";

const TABLE_NAME = "yesimbot.stickers" as const;
const DEFAULT_STORAGE_PATH = "data/yesimbot/sticker";
const DEFAULT_FALLBACK_CATEGORY = "未分类";
const DEFAULT_MAX_CATEGORY_LENGTH = 48;
const DEFAULT_SEND_DELAY_MS = 500;
const DEFAULT_DELETE_CONFIRM_TIMEOUT_MS = 60_000;
const DEFAULT_IMPORT_PROGRESS_INTERVAL = 100;
const DEFAULT_EMOJIHUB_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_CLASSIFICATION_TEMPERATURE = 0.1;
const DEFAULT_CLASSIFICATION_MAX_OUTPUT_TOKENS = 64;
const DEFAULT_MANAGE_AUTHORITY = 3;
const DEFAULT_QUERY_AUTHORITY = 0;
const DEFAULT_ONEBOT_IMAGE_SUBTYPE = "1";

const VALID_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"]);

const DEFAULT_CLASSIFICATION_PROMPT =
  "Please classify this sticker or meme image. Existing categories: {{categories}}. " +
  "Choose the most suitable existing category when possible, otherwise create a concise new one. " +
  "Return only the category name.";

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

interface StickerManagerConfig {
  storagePath: string;
  fallbackCategory: string;
  maxCategoryLength: number;
  injectCategoriesIntoPrompt: boolean;
  onebotImageSubType: string;
  manageAuthority: number;
  queryAuthority: number;
  classificationModel: string;
  classificationPrompt: string;
  classificationTemperature: number;
  classificationMaxOutputTokens: number;
  defaultEmojiHubPrefix: string;
  emojiHubRequestTimeoutMs: number;
  importProgressInterval: number;
  deleteConfirmTimeoutMs: number;
  defaultSendDelayMs: number;
}

interface ImportStats {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  failedFiles?: string[];
  failedUrls?: Array<{ url: string; error: string }>;
}

interface ImageCacheEntry {
  base64: string;
  mediaType: string;
  status: "ok" | "failed";
}

interface ImageCacheLike {
  get(id: string): Promise<ImageCacheEntry | undefined>;
}

declare module "koishi" {
  interface Context {
    "yesimbot.prompt": PromptService;
    "yesimbot.image-cache": ImageCacheLike;
  }

  interface Tables {
    [TABLE_NAME]: StickerRecord;
  }
}

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function toRawBase64(data: string): string {
  if (!data.startsWith("data:")) return data;
  const commaIndex = data.indexOf(",");
  return commaIndex >= 0 ? data.slice(commaIndex + 1) : data;
}

function extensionFromMediaType(mediaType: string): string {
  const clean = mediaType.split(";")[0]?.trim().toLowerCase();
  if (clean === "image/png") return "png";
  if (clean === "image/gif") return "gif";
  if (clean === "image/webp") return "webp";
  if (clean === "image/bmp") return "bmp";
  if (clean === "image/svg+xml") return "svg";
  return "jpg";
}

function mediaTypeFromExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".svg") return "image/svg+xml";
  return "image/jpeg";
}

function isValidImageFile(filePath: string): boolean {
  return VALID_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function sanitizeCategoryName(
  input: string,
  fallbackCategory = DEFAULT_FALLBACK_CATEGORY,
  maxCategoryLength = DEFAULT_MAX_CATEGORY_LENGTH,
): string {
  const resolvedFallback =
    fallbackCategory.replace(/[\r\n<>]+/g, " ").trim() || DEFAULT_FALLBACK_CATEGORY;

  const stripped = input
    .replace(/[\r\n]+/g, " ")
    .trim()
    .replace(/^category\s*[:：]\s*/i, "")
    .replace(/^分类\s*[:：]\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim();

  if (!stripped) return resolvedFallback;
  return stripped.slice(0, maxCategoryLength).trim() || resolvedFallback;
}

function normalizeEmojiHubUrl(rawUrl: string, prefix?: string): string {
  const clean = rawUrl.trim();
  if (!clean) throw new Error("URL 为空");
  if (/^https?:\/\//i.test(clean)) return clean;
  if (/^data:/i.test(clean)) {
    throw new Error("不支持 data URL，请提供 http/https 图片地址");
  }
  if (clean.startsWith("https:https://")) {
    return clean.replace(/^https:/, "");
  }
  if (prefix) {
    const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return new URL(clean.replace(/^\//, ""), base).toString();
  }
  if (clean.startsWith("bfs/") || clean.startsWith("/bfs/")) {
    return `https://i0.hdslb.com/${clean.replace(/^\//, "")}`;
  }
  if (clean.startsWith("meme/") || clean.startsWith("/meme/")) {
    return `https://memes.none.bot/${clean.replace(/^\//, "")}`;
  }
  return `https://i0.hdslb.com/bfs/${clean.replace(/^\/+/, "")}`;
}

function buildImportSource(session?: Session): StickerRecord["source"] {
  if (!session) {
    return {
      platform: "import",
      channelId: "",
      userId: "",
      messageId: "",
    };
  }

  return {
    platform: session.platform ?? "unknown",
    channelId: session.channelId ?? "",
    userId: session.userId ?? "",
    messageId: session.messageId ?? "",
  };
}

function formatTime(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleString("zh-CN");
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

@Metadata({
  name: "sticker-manager",
  description: "Steal, classify, manage, and send stickers for YesImBot v4.",
})
export default class StickerManager extends YesImPlugin {
  static name = "sticker-manager";
  static inject = [
    "database",
    "yesimbot.plugin",
    "yesimbot.model",
    "yesimbot.prompt",
    "yesimbot.image-cache",
  ];

  static Config: Schema<StickerManagerConfig> = Schema.intersect([
    Schema.object({
      storagePath: Schema.path({ allowCreate: true, filters: ["directory"] })
        .default(DEFAULT_STORAGE_PATH)
        .description("表情包存储目录"),
      fallbackCategory: Schema.string()
        .default(DEFAULT_FALLBACK_CATEGORY)
        .description("分类失败或模型返回空结果时使用的默认分类名"),
      maxCategoryLength: Schema.number()
        .min(1)
        .max(128)
        .default(DEFAULT_MAX_CATEGORY_LENGTH)
        .description("分类名称最大长度"),
      injectCategoriesIntoPrompt: Schema.boolean()
        .default(true)
        .description("是否将当前分类动态注入到 YesImBot 的提示词中"),
      onebotImageSubType: Schema.string()
        .default(DEFAULT_ONEBOT_IMAGE_SUBTYPE)
        .description('OneBot 平台发送图片时附带的 sub-type；留空表示不设置'),
      manageAuthority: Schema.number()
        .min(0)
        .default(DEFAULT_MANAGE_AUTHORITY)
        .description("导入、删除、合并、重命名、移动、清理等管理命令的权限等级"),
      queryAuthority: Schema.number()
        .min(0)
        .default(DEFAULT_QUERY_AUTHORITY)
        .description("sticker.get 与 sticker.info 等查询/发送命令的权限等级"),
    }).description("基础设置"),
    Schema.object({
      classificationModel: Schema.dynamic("registry.chatModels")
        .required()
        .description("用于表情包分类的多模态模型"),
      classificationPrompt: Schema.string()
        .role("textarea", { rows: [3, 6] })
        .default(DEFAULT_CLASSIFICATION_PROMPT)
        .description("表情包分类提示词，可使用 {{categories}} 占位符"),
      classificationTemperature: Schema.number()
        .min(0)
        .max(2)
        .default(DEFAULT_CLASSIFICATION_TEMPERATURE)
        .description("表情包分类模型调用的 temperature"),
      classificationMaxOutputTokens: Schema.number()
        .min(1)
        .max(512)
        .default(DEFAULT_CLASSIFICATION_MAX_OUTPUT_TOKENS)
        .description("表情包分类模型允许输出的最大 token 数"),
    }).description("分类模型"),
    Schema.object({
      defaultEmojiHubPrefix: Schema.string()
        .default("")
        .description("EmojiHub TXT 中相对路径的默认 URL 前缀，可被命令的 --prefix 覆盖"),
      emojiHubRequestTimeoutMs: Schema.number()
        .min(1000)
        .default(DEFAULT_EMOJIHUB_REQUEST_TIMEOUT_MS)
        .description("导入 EmojiHub 图片时的 HTTP 超时时间"),
      importProgressInterval: Schema.number()
        .min(0)
        .default(DEFAULT_IMPORT_PROGRESS_INTERVAL)
        .description("批量导入时每处理多少项发送一次进度消息，设为 0 可关闭"),
      deleteConfirmTimeoutMs: Schema.number()
        .min(1000)
        .default(DEFAULT_DELETE_CONFIRM_TIMEOUT_MS)
        .description("删除分类时等待确认回复的超时时间"),
      defaultSendDelayMs: Schema.number()
        .min(0)
        .default(DEFAULT_SEND_DELAY_MS)
        .description("sticker.get --all 默认发送间隔"),
    }).description("导入与发送"),
  ]);

  declare readonly ctx: Context;
  private static tableRegistered = false;
  private readonly logger;
  private readonly storagePath: string;
  private promptDisposer?: () => void;

  constructor(
    ctx: Context,
    private readonly config: StickerManagerConfig,
  ) {
    super(ctx);
    this.logger = ctx.logger("sticker-manager");
    this.storagePath = path.resolve(this.ctx.baseDir, this.config.storagePath);

    this.registerTable();
    if (this.config.injectCategoriesIntoPrompt) {
      this.promptDisposer = this.registerPromptInjection();
    }
    this.registerCommands();

    this.ctx.on("ready", async () => {
      await this.ensureStorageDir();
      this.logger.info(`Sticker storage ready: ${this.storagePath}`);
    });
    this.ctx.on("dispose", () => {
      this.promptDisposer?.();
      this.promptDisposer = undefined;
    });
  }

  private sanitizeCategory(input: string): string {
    return sanitizeCategoryName(
      input,
      this.config.fallbackCategory,
      this.config.maxCategoryLength,
    );
  }

  private resolveEmojiHubPrefix(override?: string): string | undefined {
    const resolved = (override ?? this.config.defaultEmojiHubPrefix).trim();
    return resolved || undefined;
  }

  private registerTable(): void {
    if (StickerManager.tableRegistered) return;
    StickerManager.tableRegistered = true;

    this.ctx.model.extend(
      TABLE_NAME,
      {
        id: "string(64)",
        category: "string(64)",
        filePath: "string(255)",
        source: "json",
        createdAt: "timestamp",
      },
      { primary: "id", autoInc: false },
    );
  }

  private registerPromptInjection(): () => void {
    const prompt = this.ctx["yesimbot.prompt"] as PromptService;
    return prompt.registerFragmentSource("sticker-manager", async (): Promise<PromptFragment[]> => {
      const categories = await this.getCategories();
      const categoryText = categories.length > 0 ? categories.join(", ") : "none yet";

      return [
        {
          id: "sticker-manager.policy",
          section: "policy",
          source: "tooling",
          stability: "stable",
          priority: 620,
          cacheable: true,
          content: [
            "<sticker_manager>",
            'When a user sends an image with a context tag like <img id="..."/>, you can use steal_sticker(image_id) to save it for future reuse.',
            "Use send_sticker(category) only when a saved sticker clearly improves the current reply.",
            "</sticker_manager>",
          ].join("\n"),
        },
        {
          id: "sticker-manager.catalog",
          section: "situation",
          source: "tooling",
          stability: "dynamic",
          priority: 620,
          cacheable: false,
          content: [
            "<sticker_manager_state>",
            `Current sticker categories: ${categoryText}`,
            `Fallback category: ${this.config.fallbackCategory}`,
            "</sticker_manager_state>",
          ].join("\n"),
        },
      ];
    });
  }

  private registerCommands(): void {
    this.ctx
      .command("sticker.import.emojihub <category:string> <filePath:string>", "导入 EmojiHub TXT", {
        authority: this.config.manageAuthority,
      })
      .option("prefix", "-p [prefix:string] 自定义相对 URL 前缀")
      .action(
        async (
          { session, options }: { session?: Session; options?: Record<string, unknown> },
          category?: string,
          filePath?: string,
        ) => {
          const resolvedOptions = options ?? {};
          if (!category) return "请指定分类名称";
          if (!filePath) return "请指定 TXT 文件路径";

        try {
          const normalizedCategory = this.sanitizeCategory(category);
          const stats = await this.importEmojiHubTxt(
            filePath,
            normalizedCategory,
            session,
            this.resolveEmojiHubPrefix(resolvedOptions.prefix as string | undefined),
          );

          const lines = [
            "导入完成",
            `分类: ${normalizedCategory}`,
            `文件: ${filePath}`,
            `总数: ${stats.total}`,
            `成功导入: ${stats.success}`,
            `跳过重复: ${stats.skipped}`,
            `失败: ${stats.failed}`,
          ];

          if (stats.failedUrls?.length) {
            lines.push("");
            lines.push("失败 URL:");
            for (const item of stats.failedUrls.slice(0, 5)) {
              lines.push(`- ${item.url} (${item.error})`);
            }
            if (stats.failedUrls.length > 5) {
              lines.push(`... 还有 ${stats.failedUrls.length - 5} 条失败记录`);
            }
          }

          return lines.join("\n");
        } catch (error) {
          return `导入失败: ${(error as Error).message}`;
        }
        },
      );

    this.ctx
      .command("sticker.import <sourceDir:string>", "从目录导入表情包", {
        authority: this.config.manageAuthority,
      })
      .action(async ({ session }: { session?: Session }, sourceDir?: string) => {
        if (!sourceDir) return "请指定源目录路径";

        try {
          const stats = await this.importFromDirectory(sourceDir, session);
          const lines = [
            "导入完成",
            `总数: ${stats.total}`,
            `成功导入: ${stats.success}`,
            `跳过重复: ${stats.skipped}`,
            `失败: ${stats.failed}`,
          ];

          if (stats.failedFiles?.length) {
            lines.push("");
            lines.push("失败文件:");
            for (const file of stats.failedFiles.slice(0, 10)) {
              lines.push(`- ${file}`);
            }
            if (stats.failedFiles.length > 10) {
              lines.push(`... 还有 ${stats.failedFiles.length - 10} 个文件`);
            }
          }

          return lines.join("\n");
        } catch (error) {
          return `导入失败: ${(error as Error).message}`;
        }
      });

    this.ctx
      .command("sticker.list", "列出表情包分类", {
        authority: this.config.manageAuthority,
      })
      .alias("表情分类")
      .action(async () => {
        const categories = await this.getCategories();
        if (categories.length === 0) return "暂无表情包分类";

        const lines = ["表情包分类列表:"];
        for (const category of categories) {
          const count = await this.getStickerCount(category);
          lines.push(`- ${category} (${count} 个表情包)`);
        }
        return lines.join("\n");
      });

    this.ctx
      .command("sticker.rename <oldName:string> <newName:string>", "重命名表情包分类", {
        authority: this.config.manageAuthority,
      })
      .alias("表情重命名")
      .action(async (_: unknown, oldName?: string, newName?: string) => {
        if (!oldName || !newName) return "请提供原分类名和新分类名";
        if (oldName === newName) return "新分类名不能与原分类名相同";

        try {
          const normalizedNewName = this.sanitizeCategory(newName);
          const count = await this.renameCategory(oldName, normalizedNewName);
          return `已将分类 "${oldName}" 重命名为 "${normalizedNewName}"，共更新 ${count} 个表情包`;
        } catch (error) {
          return `重命名失败: ${(error as Error).message}`;
        }
      });

    this.ctx
      .command("sticker.delete <category:string>", "删除表情包分类", {
        authority: this.config.manageAuthority,
      })
      .alias("删除分类")
      .option("force", "-f 强制删除，不做确认")
      .action(
        async (
          { session, options }: { session?: Session; options?: Record<string, unknown> },
          category?: string,
        ) => {
          const resolvedOptions = options ?? {};
          if (!category) return "请提供要删除的分类名";

        const count = await this.getStickerCount(category);
        if (count === 0) return `分类 "${category}" 中没有任何表情包`;

        if (!resolvedOptions.force) {
          if (!session) return '当前上下文无法确认删除，请追加 "-f" 强制执行';
          await session.sendQueued(
            `确定要删除分类 "${category}" 吗？该分类下有 ${count} 个表情包。\n回复“确认删除”继续，回复其他内容取消。`,
          );
          const answer = await session.prompt(this.config.deleteConfirmTimeoutMs);
          if (answer !== "确认删除") return "操作已取消";
        }

        try {
          const deletedCount = await this.deleteCategory(category);
          return `已删除分类 "${category}"，共移除 ${deletedCount} 个表情包`;
        } catch (error) {
          return `删除失败: ${(error as Error).message}`;
        }
        },
      );

    this.ctx
      .command("sticker.merge <sourceCategory:string> <targetCategory:string>", "合并表情包分类", {
        authority: this.config.manageAuthority,
      })
      .alias("合并分类")
      .action(async (_: unknown, sourceCategory?: string, targetCategory?: string) => {
        if (!sourceCategory || !targetCategory) return "请提供源分类和目标分类";
        if (sourceCategory === targetCategory) return "源分类和目标分类不能相同";

        try {
          const normalizedTarget = this.sanitizeCategory(targetCategory);
          const movedCount = await this.mergeCategories(sourceCategory, normalizedTarget);
          return `已将分类 "${sourceCategory}" 合并到 "${normalizedTarget}"，共移动 ${movedCount} 个表情包`;
        } catch (error) {
          return `合并失败: ${(error as Error).message}`;
        }
      });

    this.ctx
      .command("sticker.move <stickerId:string> <newCategory:string>", "移动表情包到新分类", {
        authority: this.config.manageAuthority,
      })
      .alias("移动表情")
      .action(async (_: unknown, stickerId?: string, newCategory?: string) => {
        if (!stickerId || !newCategory) return "请提供表情包 ID 和目标分类";

        try {
          const normalizedCategory = this.sanitizeCategory(newCategory);
          await this.moveSticker(stickerId, normalizedCategory);
          return `已将表情包 ${stickerId} 移动到分类 "${normalizedCategory}"`;
        } catch (error) {
          return `移动失败: ${(error as Error).message}`;
        }
      });

    this.ctx
      .command("sticker.get <category:string> [index:posint]", "获取指定分类的表情包", {
        authority: this.config.queryAuthority,
      })
      .option("all", "-a 发送该分类下所有表情包")
      .option("delay", "-d [delay:posint] 发送全部表情时的间隔，默认读取插件配置")
      .action(
        async (
          { session, options }: { session?: Session; options?: Record<string, unknown> },
          category?: string,
          index?: number,
        ) => {
          const resolvedOptions = options ?? {};
          if (!session) return "当前上下文无法发送表情包";
          if (!category) return "请提供分类名称";

        const stickers = await this.getStickersByCategory(category);
        if (stickers.length === 0) return `分类 "${category}" 中没有表情包`;

        const sendDelay =
          typeof resolvedOptions.delay === "number" && Number.isFinite(resolvedOptions.delay)
            ? resolvedOptions.delay
            : this.config.defaultSendDelayMs;

        if (resolvedOptions.all) {
          for (let i = 0; i < stickers.length; i++) {
            if (i > 0) await delay(sendDelay);
            await session.sendQueued(await this.buildStickerElement(stickers[i], session.platform));
          }
          return `已发送分类 "${category}" 下全部 ${stickers.length} 个表情包`;
        }

        const target =
          typeof index === "number"
            ? stickers[index - 1]
            : stickers[Math.floor(Math.random() * stickers.length)];

        if (!target) {
          return `无效序号，该分类共有 ${stickers.length} 个表情包`;
        }

        await session.sendQueued(await this.buildStickerElement(target, session.platform));
        return `ID: ${target.id}\n分类: ${target.category}`;
        },
      );

    this.ctx
      .command("sticker.info <category:string>", "查看分类详情", {
        authority: this.config.queryAuthority,
      })
      .action(async (_: unknown, category?: string) => {
        if (!category) return "请提供分类名称";

        const stickers = await this.getStickersByCategory(category);
        if (stickers.length === 0) return `分类 "${category}" 中没有表情包`;

        const latest = stickers[0];
        return [
          `分类: ${category}`,
          `数量: ${stickers.length}`,
          `最新: ${formatTime(latest.createdAt)}`,
          `使用方式: sticker.get ${category} [1-${stickers.length}]`,
        ].join("\n");
      });

    this.ctx
      .command("sticker.cleanup", "清理无引用表情包文件", {
        authority: this.config.manageAuthority,
      })
      .alias("清理表情")
      .action(async () => {
        try {
          const deletedCount = await this.cleanupUnreferenced();
          return `已清理 ${deletedCount} 个未引用表情包文件`;
        } catch (error) {
          return `清理失败: ${(error as Error).message}`;
        }
      });
  }

  private async ensureStorageDir(): Promise<void> {
    await fs.mkdir(this.storagePath, { recursive: true });
  }

  private async ensureFileExists(filePath: string, buffer: Buffer): Promise<void> {
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, buffer);
    }
  }

  private async getSticker(id: string): Promise<StickerRecord | null> {
    const records = await this.ctx.database.get(TABLE_NAME, { id });
    return (records[0] as StickerRecord | undefined) ?? null;
  }

  private async getAllStickers(): Promise<StickerRecord[]> {
    const records = await this.ctx.database
      .select(TABLE_NAME)
      .orderBy("createdAt", "desc")
      .execute();
    return records as StickerRecord[];
  }

  private async getCategories(): Promise<string[]> {
    const records = await this.getAllStickers();
    return [...new Set(records.map((record) => record.category))].sort((a, b) => a.localeCompare(b));
  }

  private async getStickerCount(category: string): Promise<number> {
    const records = await this.ctx.database.get(TABLE_NAME, { category });
    return records.length;
  }

  private async getStickersByCategory(category: string): Promise<StickerRecord[]> {
    const records = await this.ctx.database
      .select(TABLE_NAME)
      .where({ category })
      .orderBy("createdAt", "desc")
      .execute();
    return records as StickerRecord[];
  }

  private async renameCategory(oldName: string, newName: string): Promise<number> {
    const records = await this.ctx.database.get(TABLE_NAME, { category: oldName });
    if (records.length === 0) return 0;
    await this.ctx.database.set(TABLE_NAME, { category: oldName }, { category: newName });
    return records.length;
  }

  private async deleteCategory(category: string): Promise<number> {
    const records = (await this.ctx.database.get(TABLE_NAME, { category })) as StickerRecord[];
    if (records.length === 0) return 0;

    await this.ctx.database.remove(TABLE_NAME, { category });
    for (const record of records) {
      try {
        await fs.unlink(record.filePath);
      } catch {}
    }
    return records.length;
  }

  private async mergeCategories(sourceCategory: string, targetCategory: string): Promise<number> {
    const records = await this.ctx.database.get(TABLE_NAME, { category: sourceCategory });
    if (records.length === 0) return 0;
    await this.ctx.database.set(TABLE_NAME, { category: sourceCategory }, { category: targetCategory });
    return records.length;
  }

  private async moveSticker(stickerId: string, newCategory: string): Promise<void> {
    const record = await this.getSticker(stickerId);
    if (!record) throw new Error("未找到该表情包");
    await this.ctx.database.set(TABLE_NAME, { id: stickerId }, { category: newCategory });
  }

  private async cleanupUnreferenced(): Promise<number> {
    await this.ensureStorageDir();
    const knownFiles = new Set((await this.getAllStickers()).map((record) => path.resolve(record.filePath)));
    const entries = await fs.readdir(this.storagePath, { withFileTypes: true });

    let deletedCount = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = path.resolve(this.storagePath, entry.name);
      if (!isValidImageFile(fullPath)) continue;
      if (knownFiles.has(fullPath)) continue;

      await fs.unlink(fullPath);
      deletedCount += 1;
    }

    return deletedCount;
  }

  private async buildStickerElement(
    record: StickerRecord,
    platform?: string,
  ): Promise<ReturnType<typeof h.image>> {
    const buffer = await fs.readFile(record.filePath);
    const mediaType = mediaTypeFromExtension(record.filePath);
    const subtype = this.config.onebotImageSubType.trim();
    const attrs = platform === "onebot" && subtype ? { "sub-type": subtype } : undefined;
    return attrs ? h.image(buffer, mediaType, attrs) : h.image(buffer, mediaType);
  }

  private async classifySticker(base64: string, mediaType: string): Promise<string> {
    const modelService = this.ctx["yesimbot.model"] as ModelService;
    const categories = await this.getCategories();
    const categoryText = categories.length > 0 ? categories.join(", ") : "none yet";
    const prompt = this.config.classificationPrompt.replace("{{categories}}", categoryText);

    try {
      const result = await modelService.call(this.config.classificationModel, {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image", image: toRawBase64(base64), mediaType },
            ],
          },
        ],
        temperature: this.config.classificationTemperature,
        maxOutputTokens: this.config.classificationMaxOutputTokens,
      });

      return this.sanitizeCategory(result?.text ?? this.config.fallbackCategory);
    } catch (error) {
      this.logger.warn(
        `Sticker classification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.config.fallbackCategory;
    }
  }

  private async saveStickerBuffer(
    buffer: Buffer,
    mediaType: string,
    category: string,
    source: StickerRecord["source"],
  ): Promise<{ record: StickerRecord; created: boolean }> {
    await this.ensureStorageDir();

    const id = hashBuffer(buffer);
    const existing = await this.getSticker(id);
    if (existing) {
      await this.ensureFileExists(existing.filePath, buffer);
      return { record: existing, created: false };
    }

    const ext = extensionFromMediaType(mediaType);
    const filePath = path.resolve(this.storagePath, `${id}.${ext}`);
    const record: StickerRecord = {
      id,
      category: this.sanitizeCategory(category),
      filePath,
      source,
      createdAt: new Date(),
    };

    await fs.writeFile(filePath, buffer);
    await this.ctx.database.create(TABLE_NAME, record);
    return { record, created: true };
  }

  private async importSingleSticker(
    filePath: string,
    category: string,
    session?: Session,
  ): Promise<"success" | "duplicate"> {
    if (!isValidImageFile(filePath)) {
      throw new Error("不支持的文件类型");
    }

    const buffer = await fs.readFile(filePath);
    const mediaType = mediaTypeFromExtension(filePath);
    const result = await this.saveStickerBuffer(
      buffer,
      mediaType,
      category,
      buildImportSource(session),
    );

    return result.created ? "success" : "duplicate";
  }

  private async importFromDirectory(sourceDir: string, session?: Session): Promise<ImportStats> {
    const resolvedSourceDir = path.resolve(sourceDir);
    const stats: ImportStats = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      failedFiles: [],
    };

    const entries = await fs.readdir(resolvedSourceDir, { withFileTypes: true });
    const categories = entries.filter((entry) => entry.isDirectory());
    if (categories.length === 0) {
      throw new Error("源目录下未找到任何分类子目录");
    }

    for (const entry of categories) {
      const category = this.sanitizeCategory(entry.name);
      const categoryDir = path.join(resolvedSourceDir, entry.name);
      const files = await fs.readdir(categoryDir, { withFileTypes: true });

      for (const file of files) {
        if (!file.isFile()) continue;
        const filePath = path.join(categoryDir, file.name);
        if (!isValidImageFile(filePath)) continue;

        stats.total += 1;
        try {
          const result = await this.importSingleSticker(filePath, category, session);
          if (result === "success") {
            stats.success += 1;
          } else {
            stats.skipped += 1;
          }
        } catch {
          stats.failed += 1;
          stats.failedFiles?.push(filePath);
        }
      }
    }

    return stats;
  }

  private async importEmojiHubTxt(
    filePath: string,
    category: string,
    session?: Session,
    prefix?: string,
  ): Promise<ImportStats> {
    const stats: ImportStats = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      failedUrls: [],
    };

    const content = await fs.readFile(path.resolve(filePath), "utf8");
    const urls = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (urls.length === 0) {
      throw new Error("TXT 文件为空或没有有效 URL");
    }

    stats.total = urls.length;

    for (let index = 0; index < urls.length; index++) {
      const rawUrl = urls[index]!;
      try {
        if (
          session &&
          this.config.importProgressInterval > 0 &&
          index > 0 &&
          index % this.config.importProgressInterval === 0
        ) {
          await session.sendQueued(`已处理 ${index}/${urls.length} 个 URL...`);
        }

        const url = normalizeEmojiHubUrl(rawUrl, prefix);
        const response = await this.ctx.http(url, {
          responseType: "arraybuffer",
          timeout: this.config.emojiHubRequestTimeoutMs,
          validateStatus: () => true,
        });

        if (response.status < 200 || response.status >= 300) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get("content-type") ?? "image/jpeg";
        const buffer = Buffer.from(response.data);
        const result = await this.saveStickerBuffer(
          buffer,
          contentType,
          category,
          buildImportSource(session),
        );

        if (result.created) {
          stats.success += 1;
        } else {
          stats.skipped += 1;
        }
      } catch (error) {
        stats.failed += 1;
        stats.failedUrls?.push({
          url: rawUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return stats;
  }

  @Tool({
    name: "steal_sticker",
    description:
      "Save a user-provided image or sticker from the current conversation into the sticker library and return the stored category.",
    parameters: withInnerThoughts({
      image_id: Schema.string()
        .required()
        .description('Image ID from a conversation <img id="..."/> tag'),
    }),
    requiredCapabilities: ["platform.session"],
    onCapabilityMissing: "remove",
  })
  async stealSticker(
    params: Record<string, unknown>,
    execCtx: ToolExecutionContext,
  ) {
    const imageId = String(params["image_id"] ?? "").trim();
    if (!imageId) return Failed("image_id is required");
    if (!execCtx.session) return Failed("No active session");

    const imageCache = this.ctx["yesimbot.image-cache"];
    const cached = await imageCache.get(imageId);
    if (!cached || cached.status === "failed") {
      return Failed(`Image not found in cache: ${imageId}`);
    }

    const buffer = Buffer.from(toRawBase64(cached.base64), "base64");
    const existing = await this.getSticker(hashBuffer(buffer));
    if (existing) {
      return Success({
        id: existing.id,
        category: existing.category,
        created: false,
        message: `Sticker already exists in category "${existing.category}"`,
      });
    }

    const category = await this.classifySticker(cached.base64, cached.mediaType);
    const result = await this.saveStickerBuffer(
      buffer,
      cached.mediaType,
      category,
      buildImportSource(execCtx.session),
    );

    return Success({
      id: result.record.id,
      category: result.record.category,
      created: result.created,
      message: `Saved sticker to category "${result.record.category}"`,
    });
  }

  @Action({
    name: "send_sticker",
    description:
      "Send one saved sticker from a chosen category to the current channel when it clearly fits the tone and context.",
    parameters: withInnerThoughts({
      category: Schema.string()
        .required()
        .description("Existing sticker category name to send from"),
    }),
    requiredCapabilities: ["platform.session"],
    onCapabilityMissing: "remove",
  })
  async sendSticker(
    params: Record<string, unknown>,
    execCtx: ToolExecutionContext,
  ) {
    const category = String(params["category"] ?? "").trim();
    if (!category) return Failed("category is required");
    if (!execCtx.session) return Failed("No active session");

    const stickers = await this.getStickersByCategory(category);
    if (stickers.length === 0) {
      return Failed(`No stickers found in category "${category}"`);
    }

    const sticker = stickers[Math.floor(Math.random() * stickers.length)]!;
    await execCtx.session.sendQueued(
      await this.buildStickerElement(sticker, execCtx.session.platform),
    );

    return Success({
      id: sticker.id,
      category: sticker.category,
      message: `Sent a sticker from "${sticker.category}"`,
    });
  }
}
