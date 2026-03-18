import { cpSync, existsSync, mkdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join, resolve } from "node:path";

import { Context, Schema, Service } from "koishi";

import { HandlebarsRenderer } from "../prompt/renderer";
import type { PromptService } from "../prompt/service";
import type { Percept, Scenario } from "../runtime/contracts";
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
  private templateRenderer = new HandlebarsRenderer();
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
    this.loadAndRegisterFragments();
    this.registerSnippets();
    this.startWatching();
    this.logger.info("RoleService started");
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
      const scenario = scope.scenario as Scenario | undefined;
      if (!scenario) return "";
      return scenario.raw.environment.name ?? "";
    });
    this.prompt.registerSnippet("channel.platform", (scope) => {
      const scenario = scope.scenario as Scenario | undefined;
      if (!scenario) return "";
      return scenario.raw.environment.platform ?? "";
    });

    this.prompt.registerSnippet("bot.name", (scope) => {
      const scenario = scope.scenario as Scenario | undefined;
      if (!scenario) return "";
      return scenario.raw.self.name ?? "";
    });
    this.prompt.registerSnippet("bot.id", (scope) => {
      const scenario = scope.scenario as Scenario | undefined;
      if (!scenario) return "";
      return scenario.raw.self.id ?? "";
    });
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
      const rendered = this.templateRenderer.render(content, scope, `role:${name}`);
      this.lastValid.set(name, rendered);
      return rendered;
    } catch (e) {
      this.logger.warn("Template render error in %s: %s", name, e);
      return this.lastValid.get(name) ?? content;
    }
  }

  private loadAndRegisterFragments(): void {
    for (const d of this.disposers) d();
    this.disposers = [];

    // Invalidate stale compiled templates on reload
    this.templateRenderer.clearCache();

    // SOUL.md -> identity section
    const soulContent = this.loadFile("SOUL.md") ?? "You are {{bot.name}}.";

    // AGENTS.md -> policy section
    const agentsContent = this.loadFile("AGENTS.md") ?? "Respond helpfully.";

    // TOOLS.md -> policy section (after AGENTS via lower priority)
    const toolsContent = this.loadFile("TOOLS.md") ?? "";
    this.disposers.push(
      this.prompt.registerFragmentSource("role", (scope) => [
        {
          id: "role.soul",
          content: this.renderSafe("SOUL.md", soulContent, scope),
          section: "identity",
          source: "role",
          stability: "stable",
          priority: 700,
          cacheable: true,
        },
        {
          id: "role.agents",
          content: this.renderSafe("AGENTS.md", agentsContent, scope),
          section: "policy",
          source: "role",
          stability: "stable",
          priority: 700,
          cacheable: true,
        },
        {
          id: "role.tools",
          content: this.renderSafe("TOOLS.md", toolsContent, scope),
          section: "policy",
          source: "role",
          stability: "stable",
          priority: 690,
          cacheable: true,
        },
      ]),
    );
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
        this.loadAndRegisterFragments();
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
