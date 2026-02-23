import { cpSync, existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path, { basename, extname, join } from "node:path";

import matter from "gray-matter";
import { Context, Schema, Service } from "koishi";
import Mustache from "mustache";

import type { HorizonView } from "../horizon";
import { PromptService } from "../prompt";
import type { Percept } from "../shared/types";
import type { MemoryBlock } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.memory": MemoryService;
  }
}

export interface MemoryServiceConfig {
  coreMemoryPath?: string;
  memoryCharLimit?: number;
}

export const MemoryServiceConfigSchema: Schema<MemoryServiceConfig> = Schema.object({
  coreMemoryPath: Schema.path({ filters: ["directory"], allowCreate: true }).default(
    "data/yesimbot/memories",
  ),
  memoryCharLimit: Schema.number().default(4000),
});

export class MemoryService extends Service<MemoryServiceConfig> {
  static inject = ["yesimbot.prompt"];

  private blocks: MemoryBlock[] = [];
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private prompt: PromptService;
  private coreMemoryPath: string;

  constructor(ctx: Context, config: MemoryServiceConfig) {
    super(ctx, "yesimbot.memory", false);
    this.config = config;
    this.logger = ctx.logger("memory");
    this.prompt = ctx["yesimbot.prompt"];
    this.coreMemoryPath = path.resolve(
      ctx.baseDir,
      this.config.coreMemoryPath || "data/yesimbot/memories",
    );
  }

  protected async start(): Promise<void> {
    await this.loadBlocks();
    this.startWatching();
    this.registerInjection();
    this.registerSnippets();
    this.logger.info("MemoryService started, %d blocks loaded", this.blocks.length);
  }

  private async ensureCoreMemoryDir(): Promise<void> {
    try {
      if (!existsSync(this.coreMemoryPath)) {
        this.logger.info("Memory directory does not exist, creating: %s", this.coreMemoryPath);
        mkdirSync(this.coreMemoryPath, { recursive: true });
      }
      const entries = await readdir(this.coreMemoryPath);
      const files = entries.filter((f) => /\.(md|txt)$/.test(f)).sort();

      if (!files.length) {
        // copy default persona if no files exist
        const defaultPath = join(this.prompt.resourcesDir, "default-persona.md");
        if (existsSync(defaultPath)) {
          cpSync(defaultPath, join(this.coreMemoryPath, "persona.md"), { force: false });
          this.logger.info("Default persona copied to memory directory");
          entries.push("persona.md");
        }
      }
    } catch (e) {
      this.logger.warn("Failed to ensure memory directory: %s", e);
    }
  }

  private async loadBlocks(): Promise<void> {
    try {
      await this.ensureCoreMemoryDir();
      const entries = await readdir(this.coreMemoryPath);
      const files = entries.filter((f) => /\.(md|txt)$/.test(f)).sort();

      const blocks: MemoryBlock[] = [];
      for (const file of files) {
        try {
          const raw = await readFile(join(this.coreMemoryPath, file), "utf-8");
          const { meta, content } = this.parseFrontmatter(raw);
          blocks.push({
            label: (meta.label as string) || basename(file, extname(file)),
            title: meta.title as string | undefined,
            description: meta.description as string | undefined,
            content,
            filename: file,
          });
        } catch (e) {
          this.logger.warn("Failed to load memory file %s: %s", file, e);
        }
      }
      this.blocks = blocks;
    } catch (e) {
      this.logger.warn("Failed to read memory directory: %s", e);
    }
  }

  private parseFrontmatter(raw: string): { meta: Record<string, unknown>; content: string } {
    const { data, content } = matter(raw);
    return { meta: data, content: content.trim() };
  }

  private startWatching(): void {
    if (!this.config.coreMemoryPath) return;
    const log = this.ctx.logger("yesimbot.memory");

    this.watcher = watch(this.config.coreMemoryPath, () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.loadBlocks().then(() => {
          log.info("Memory blocks reloaded, %d blocks", this.blocks.length);
        });
      }, 300);
    });

    this.ctx.on("dispose", () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.watcher?.close();
    });
  }

  private registerSnippets(): void {
    const fmt = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    this.prompt.registerSnippet("date.now", () => fmt.format(new Date()));

    this.prompt.registerSnippet("sender.name", (scope) => {
      const percept = scope.percept as Percept | undefined;
      return (percept?.metadata?.senderName as string) ?? "";
    });
    this.prompt.registerSnippet("sender.id", (scope) => {
      const percept = scope.percept as Percept | undefined;
      return (percept?.metadata?.senderId as string) ?? "";
    });

    this.prompt.registerSnippet("channel.name", (scope) => {
      const view = scope.view as HorizonView | undefined;
      return view?.environment?.name ?? "";
    });
    this.prompt.registerSnippet("channel.platform", (scope) => {
      const view = scope.view as HorizonView | undefined;
      return (view?.environment?.metadata?.platform as string) ?? "";
    });

    this.prompt.registerSnippet("bot.name", (scope) => {
      const view = scope.view as HorizonView | undefined;
      return view?.self?.name ?? "";
    });
    this.prompt.registerSnippet("bot.id", (scope) => {
      const view = scope.view as HorizonView | undefined;
      return view?.self?.id ?? "";
    });
  }

  private registerInjection(): void {
    const limit = this.config.memoryCharLimit ?? 4000;
    const coreMemoryTpl = this.prompt.loadTemplate("core-memory");
    const partials = { "memory-block": this.prompt.loadPartial("memory-block") };

    this.prompt.inject(this.ctx, "memory", {
      name: "core-memory",
      renderFn: (scope: Record<string, unknown>) => {
        if (!this.blocks.length) return "";

        let used = 0;
        const blocks: { label: string; title?: string; rendered: string }[] = [];

        for (const block of this.blocks) {
          const rendered = Mustache.render(block.content, scope);
          const est = `<${block.label}>${rendered}</${block.label}>`.length;
          if (used + est > limit && blocks.length > 0) {
            this.logger.warn("Memory char limit reached, skipping remaining blocks");
            break;
          }
          blocks.push({ label: block.label, title: block.title, rendered });
          used += est;
        }

        return blocks.length ? Mustache.render(coreMemoryTpl, { blocks }, partials) : "";
      },
    });
  }
}
