import { cpSync, existsSync, mkdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join, resolve } from "node:path";

import { Context, Schema, Service } from "koishi";
import Mustache from "mustache";

import type { PromptService } from "../prompt/service";
import type { RoleServiceConfig } from "./types";
import { RoleServiceConfigSchema } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.role": RoleService;
  }
}

const ROLE_FILES = ["SOUL.md", "AGENTS.md", "TOOLS.md"] as const;

const builtinRolesDir = resolve(
  __dirname,
  "../".repeat(__dirname.includes("dist") ? 1 : 2),
  "resources/roles",
);

export class RoleService extends Service<RoleServiceConfig> {
  static inject = ["yesimbot.prompt"];
  static Config = RoleServiceConfigSchema;

  private prompt: PromptService;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private disposers: Array<() => void> = [];
  private lastValid = new Map<string, string>();

  constructor(ctx: Context, config: RoleServiceConfig) {
    super(ctx, "yesimbot.role", false);
    this.config = config;
    this.logger = ctx.logger("role");
    this.prompt = ctx["yesimbot.prompt"];
  }

  protected async start(): Promise<void> {
    this.ensureFiles();
    this.loadAndInject();
    this.startWatching();
    this.logger.info("RoleService started");
  }

  private ensureFiles(): void {
    const dir = this.config.rolePath ?? "data/yesimbot/roles";
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    for (const name of ROLE_FILES) {
      const userPath = join(dir, name);
      if (existsSync(userPath)) {
        this.logger.debug("Role file %s already exists, skipping seed", name);
        continue;
      }
      const bundledPath = join(builtinRolesDir, name);
      if (existsSync(bundledPath)) {
        cpSync(bundledPath, userPath);
        this.logger.info("Seeded default %s", name);
      }
    }
  }

  private loadFile(name: string): string | null {
    try {
      return readFileSync(join(this.config.rolePath ?? "data/yesimbot/roles", name), "utf-8");
    } catch {
      return null;
    }
  }

  private renderSafe(name: string, content: string, scope: Record<string, unknown>): string {
    try {
      const rendered = Mustache.render(content, scope);
      this.lastValid.set(name, rendered);
      return rendered;
    } catch (e) {
      this.logger.warn("Mustache render error in %s: %s", name, e);
      return this.lastValid.get(name) ?? content;
    }
  }

  private loadAndInject(): void {
    for (const d of this.disposers) d();
    this.disposers = [];

    // SOUL.md -> soul point
    const soulContent = this.loadFile("SOUL.md") ?? "You are {{bot.name}}.";
    this.disposers.push(
      this.prompt.inject(this.ctx, "soul", {
        name: "__role_soul",
        renderFn: (scope) => this.renderSafe("SOUL.md", soulContent, scope),
      }),
    );

    // AGENTS.md -> instructions point
    const agentsContent = this.loadFile("AGENTS.md") ?? "Respond helpfully.";
    this.disposers.push(
      this.prompt.inject(this.ctx, "instructions", {
        name: "__role_agents",
        renderFn: (scope) => this.renderSafe("AGENTS.md", agentsContent, scope),
      }),
    );

    // TOOLS.md -> instructions point (optional, silently skip if absent)
    const toolsContent = this.loadFile("TOOLS.md");
    if (toolsContent !== null) {
      this.disposers.push(
        this.prompt.inject(this.ctx, "instructions", {
          name: "__role_tools",
          after: "__role_agents",
          renderFn: (scope) => this.renderSafe("TOOLS.md", toolsContent, scope),
        }),
      );
    }
  }

  getSoulSummary(maxChars = 300): string {
    const rendered = this.lastValid.get("SOUL.md");
    if (!rendered) return "A conversational chat bot.";

    const text = rendered.trim();
    if (text.length <= maxChars) return text;

    // Trim at last sentence boundary within maxChars
    const slice = text.slice(0, maxChars);
    const lastPeriod = slice.lastIndexOf(".");
    const lastNewline = slice.lastIndexOf("\n");
    const boundary = Math.max(lastPeriod, lastNewline);

    if (boundary > maxChars * 0.3) {
      return text.slice(0, boundary + 1).trim();
    }
    // No good boundary — trim at last space to avoid mid-word cutoff
    const lastSpace = slice.lastIndexOf(" ");
    return lastSpace > 0 ? text.slice(0, lastSpace).trim() + "..." : slice;
  }

  private startWatching(): void {
    const dir = this.config.rolePath ?? "data/yesimbot/roles";
    if (!existsSync(dir)) return;

    this.watcher = watch(dir, () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.loadAndInject();
        this.logger.debug("Role files reloaded");
      }, 300);
    });

    this.ctx.on("dispose", () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.watcher?.close();
    });
  }
}

export { RoleServiceConfigSchema } from "./types";
export type { RoleServiceConfig } from "./types";
