import { readdir, readFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { join, extname, basename } from "node:path";

import { load as yamlLoad } from "js-yaml";
import Mustache from "mustache";
import { Context, Service } from "koishi";

import type { HorizonView } from "../horizon/types";
import type { MemoryBlock, MemoryConfig } from "./types";

const DEFAULT_PERSONA = `## 关于我

我是一个友好的聊天伙伴。我会根据对话内容自然地回应，保持真诚和适度的好奇心。

## 交流风格

- 自然对话，不过度正式也不过度随意
- 根据对方的语气和话题调整回应方式
- 有自己的想法，但尊重不同观点`;

declare module "koishi" {
  interface Context {
    "yesimbot.memory": MemoryService;
  }
}

export class MemoryService extends Service<MemoryConfig> {
  static inject = ["yesimbot.prompt"];

  private blocks: MemoryBlock[] = [];
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: Context, config: MemoryConfig) {
    super(ctx, "yesimbot.memory", false);
    this.config = config;
  }

  protected async start(): Promise<void> {
    const log = this.ctx.logger("yesimbot.memory");
    await this.loadBlocks();
    this.startWatching();
    this.registerInjection();
    this.registerSnippets();
    log.info("MemoryService started, %d blocks loaded", this.blocks.length);
  }

  private async loadBlocks(): Promise<void> {
    const log = this.ctx.logger("yesimbot.memory");
    if (!this.config.coreMemoryPath) {
      this.blocks = [{ label: "persona", content: DEFAULT_PERSONA, filename: "__default__" }];
      return;
    }

    try {
      const entries = await readdir(this.config.coreMemoryPath);
      const files = entries
        .filter((f) => /\.(md|txt)$/.test(f))
        .sort();

      if (!files.length) {
        this.blocks = [{ label: "persona", content: DEFAULT_PERSONA, filename: "__default__" }];
        return;
      }

      const blocks: MemoryBlock[] = [];
      for (const file of files) {
        try {
          const raw = await readFile(join(this.config.coreMemoryPath, file), "utf-8");
          const { meta, content } = this.parseFrontmatter(raw);
          blocks.push({
            label: (meta.label as string) || basename(file, extname(file)),
            title: meta.title as string | undefined,
            description: meta.description as string | undefined,
            content,
            filename: file,
          });
        } catch (e) {
          log.warn("Failed to load memory file %s: %s", file, e);
        }
      }
      this.blocks = blocks.length
        ? blocks
        : [{ label: "persona", content: DEFAULT_PERSONA, filename: "__default__" }];
    } catch (e) {
      log.warn("Failed to read memory directory: %s", e);
      this.blocks = [{ label: "persona", content: DEFAULT_PERSONA, filename: "__default__" }];
    }
  }

  private parseFrontmatter(raw: string): { meta: Record<string, unknown>; content: string } {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return { meta: {}, content: raw.trim() };
    const meta = (yamlLoad(match[1]) as Record<string, unknown>) ?? {};
    return { meta, content: match[2].trim() };
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
    const prompt = this.ctx["yesimbot.prompt"];
    const fmt = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "long", day: "numeric",
      weekday: "long", hour: "numeric", minute: "2-digit", hour12: true,
    });

    prompt.registerSnippet("date.now", () => fmt.format(new Date()));

    prompt.registerSnippet("sender.name", (scope) => {
      const view = scope.view as HorizonView | undefined;
      return (view?.percept as { payload?: { sender?: { name?: string } } })?.payload?.sender?.name ?? "";
    });
    prompt.registerSnippet("sender.id", (scope) => {
      const view = scope.view as HorizonView | undefined;
      return (view?.percept as { payload?: { sender?: { id?: string } } })?.payload?.sender?.id ?? "";
    });

    prompt.registerSnippet("channel.name", (scope) => {
      const view = scope.view as HorizonView | undefined;
      return view?.environment?.name ?? "";
    });
    prompt.registerSnippet("channel.platform", (scope) => {
      const view = scope.view as HorizonView | undefined;
      return (view?.environment?.metadata?.platform as string) ?? "";
    });

    prompt.registerSnippet("bot.name", (scope) => {
      const view = scope.view as HorizonView | undefined;
      return view?.self?.name ?? "";
    });
    prompt.registerSnippet("bot.id", (scope) => {
      const view = scope.view as HorizonView | undefined;
      return view?.self?.id ?? "";
    });
  }

  private registerInjection(): void {
    const log = this.ctx.logger("yesimbot.memory");
    const limit = this.config.memoryCharLimit ?? 4000;

    this.ctx["yesimbot.prompt"].inject("core-memory", 10, (scope) => {
      if (!this.blocks.length) return "";

      let used = 0;
      const parts: string[] = [];

      for (const block of this.blocks) {
        const rendered = Mustache.render(block.content, scope);
        const blockXml = block.title
          ? `<${block.label}>\n<title>${block.title}</title>\n${rendered}\n</${block.label}>`
          : `<${block.label}>\n${rendered}\n</${block.label}>`;

        if (used + blockXml.length > limit && parts.length > 0) {
          log.warn("Memory char limit reached, skipping remaining blocks");
          break;
        }
        parts.push(blockXml);
        used += blockXml.length;
      }

      return parts.length ? `<core_memory>\n${parts.join("\n\n")}\n</core_memory>` : "";
    });
  }
}

export type { MemoryConfig } from "./types";
