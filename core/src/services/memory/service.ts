import { readFileSync, watch, type FSWatcher } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";

import { load as yamlLoad } from "js-yaml";
import { Context, Schema, Service } from "koishi";
import Mustache from "mustache";

import type { HorizonView } from "../horizon";
import { PromptService } from "../prompt";
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
  coreMemoryPath: Schema.path({ filters: ["directory"] }).description(
    "Directory containing memory block files (.md/.txt)",
  ),
  memoryCharLimit: Schema.number()
    .default(4000)
    .description("Maximum characters for memory block injection"),
});

export class MemoryService extends Service<MemoryServiceConfig> {
  static inject = ["yesimbot.prompt"];

  private blocks: MemoryBlock[] = [];
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private defaultPersona: string;
  private prompt: PromptService;

  constructor(ctx: Context, config: MemoryServiceConfig) {
    super(ctx, "yesimbot.memory", false);
    this.config = config;
    this.logger = ctx.logger("memory");
    this.prompt = ctx["yesimbot.prompt"];
    this.defaultPersona = readFileSync(
      join(this.prompt.resourcesDir, "default-persona.mustache"),
      "utf-8",
    );
  }

  protected async start(): Promise<void> {
    await this.loadBlocks();
    this.startWatching();
    this.registerInjection();
    this.registerSnippets();
    this.logger.info("MemoryService started, %d blocks loaded", this.blocks.length);
  }

  private async loadBlocks(): Promise<void> {
    const log = this.ctx.logger("yesimbot.memory");
    if (!this.config.coreMemoryPath) {
      this.blocks = [{ label: "persona", content: this.defaultPersona, filename: "__default__" }];
      return;
    }

    try {
      const entries = await readdir(this.config.coreMemoryPath);
      const files = entries.filter((f) => /\.(md|txt)$/.test(f)).sort();

      if (!files.length) {
        this.blocks = [{ label: "persona", content: this.defaultPersona, filename: "__default__" }];
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
          this.logger.warn("Failed to load memory file %s: %s", file, e);
        }
      }
      this.blocks = blocks.length
        ? blocks
        : [{ label: "persona", content: this.defaultPersona, filename: "__default__" }];
    } catch (e) {
      this.logger.warn("Failed to read memory directory: %s", e);
      this.blocks = [{ label: "persona", content: this.defaultPersona, filename: "__default__" }];
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
      const view = scope.view as HorizonView | undefined;
      return (
        (view?.percept as { payload?: { sender?: { name?: string } } })?.payload?.sender?.name ?? ""
      );
    });
    this.prompt.registerSnippet("sender.id", (scope) => {
      const view = scope.view as HorizonView | undefined;
      return (
        (view?.percept as { payload?: { sender?: { id?: string } } })?.payload?.sender?.id ?? ""
      );
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

    this.prompt.inject(this.ctx, "core_memories", {
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
