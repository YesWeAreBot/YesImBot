import { Context, Service } from "koishi";

import { loadTemplate } from "./loader";
import { MustacheRenderer } from "./renderer";
import type { Injection, Snippet } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.prompt": PromptService;
  }
}

export interface PromptServiceConfig {
  templates?: Record<string, string>;
}

export class PromptService extends Service<PromptServiceConfig> {
  private templates = new Map<string, string>();
  private snippets = new Map<string, Snippet>();
  private injections: Injection[] = [];
  private renderer = new MustacheRenderer();

  constructor(ctx: Context, config: PromptServiceConfig) {
    super(ctx, "yesimbot.prompt", true);
    this.config = config;
    this.logger = this.ctx.logger("yesimbot.prompt");
    this.registerTemplate("system", loadTemplate("system"));
  }

  getTemplate(name: string): string {
    return this.templates.get(name) ?? "";
  }

  registerTemplate(name: string, content: string): void {
    this.templates.set(name, content);
  }

  registerSnippet(name: string, fn: Snippet): void {
    this.snippets.set(name, fn);
  }

  inject(name: string, priority: number, renderFn: Snippet): void {
    this.injections.push({ name, priority, renderFn });
  }

  removeInjection(name: string): void {
    this.injections = this.injections.filter((i) => i.name !== name);
  }

  async render(templateName: string, initialScope?: Record<string, unknown>): Promise<string> {
    const templateContent =
      this.config.templates?.[templateName] ?? this.templates.get(templateName);
    if (!templateContent) {
      this.logger.warn(`No template found for key "${templateName}"`);
      return "";
    }

    const requiredVars = this.getRequiredVariables(templateContent);
    const scope = await this.buildScope(initialScope ?? {}, requiredVars);

    const sorted = [...this.injections].sort((a, b) => a.priority - b.priority);
    const fragments: string[] = [];
    for (const inj of sorted) {
      const result = await inj.renderFn(scope);
      if (result) fragments.push(String(result));
    }
    if (fragments.length) scope["injections"] = fragments.join("\n\n");

    const partials = Object.fromEntries(this.templates);
    const result = this.renderer.render(templateContent, scope, partials);
    if (!result) this.logger.warn(`Template "${templateName}" rendered to empty string`);
    return result;
  }

  private getRequiredVariables(template: string): Set<string> {
    const vars = new Set<string>();
    for (const m of template.matchAll(/\{{2,3}([^#^/!>{ ][^}]*?)\}{2,3}/g)) {
      vars.add(m[1].trim());
    }
    return vars;
  }

  private async buildScope(
    initialScope: Record<string, unknown>,
    requiredVars: Set<string>,
  ): Promise<Record<string, unknown>> {
    const scope: Record<string, unknown> = { ...initialScope };
    for (const [key, fn] of this.snippets) {
      if (requiredVars.has(key)) {
        const result = await fn(scope);
        this.setNestedProperty(scope, key, result);
      }
    }
    return scope;
  }

  private setNestedProperty(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split(".");
    let cur: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) {
        cur[parts[i]] = {};
      }
      cur = cur[parts[i]] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
  }
}
