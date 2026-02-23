import { cpSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Context, Schema, Service } from "koishi";

import { MustacheRenderer } from "./renderer";
import type { InjectionEntry, InjectionPoint, Section, Snippet } from "./types";
import { INJECTION_POINTS } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.prompt": PromptService;
  }
}

export interface PromptServiceConfig {
  templates?: Record<string, string>;
  timeout?: number;
  resourcesDir?: string;
}

export const PromptServiceConfigSchema: Schema<PromptServiceConfig> = Schema.object({
  templates: Schema.dict(Schema.string()),
  timeout: Schema.number().default(5000).description("Injection render timeout (ms)"),
  resourcesDir: Schema.string().description("Custom templates directory"),
});

const CACHEABLE_POINTS = new Set<InjectionPoint>(INJECTION_POINTS);

export class PromptService extends Service<PromptServiceConfig> {
  private templates = new Map<string, string>();
  private snippets = new Map<string, Snippet>();
  private injections = new Map<InjectionPoint, InjectionEntry[]>();
  private partials = new Map<string, string>();
  private renderer = new MustacheRenderer();
  readonly resourcesDir: string;

  constructor(ctx: Context, config: PromptServiceConfig) {
    super(ctx, "yesimbot.prompt", true);
    this.config = config;
    this.logger = this.ctx.logger("yesimbot.prompt");

    // Resolve resources directory; seed from builtin if custom dir lacks templates
    this.resourcesDir = config.resourcesDir ?? builtinResourcesDir;
    if (
      this.resourcesDir !== builtinResourcesDir &&
      !existsSync(resolve(this.resourcesDir, "system.mustache"))
    ) {
      cpSync(builtinResourcesDir, this.resourcesDir, { recursive: true });
      this.logger.info(`Seeded templates to "${this.resourcesDir}"`);
    }

    for (const point of INJECTION_POINTS) {
      this.injections.set(point, []);
    }
    this.registerTemplate("system", this.loadTemplate("system"));

    const partialMap: Record<string, string> = {
      extra: "extra",
      "horizon-view": "horizon-view",
      "memory-block": "memory-block",
      memory: "memory",
    };
    for (const [name, file] of Object.entries(partialMap)) {
      this.registerPartial(name, this.loadPartial(file));
    }
  }

  getTemplate(name: string): string {
    return this.templates.get(name) ?? "";
  }

  loadTemplate(name: string, ext: string = "mustache"): string {
    return readFileSync(resolve(this.resourcesDir, `${name}.${ext}`), "utf-8");
  }

  loadPartial(name: string): string {
    return this.loadTemplate(`partials/${name}`);
  }

  registerTemplate(name: string, content: string): void {
    this.templates.set(name, content);
  }

  registerSnippet(name: string, fn: Snippet): void {
    this.snippets.set(name, fn);
  }

  registerPartial(name: string, content: string): void {
    if (this.partials.has(name)) {
      this.logger.info(`Overriding partial "${name}"`);
    }
    this.partials.set(name, content);
  }

  inject(ctx: Context, point: InjectionPoint, entry: InjectionEntry): () => void {
    const list = this.injections.get(point);
    if (!list) {
      throw new Error(`Unrecognized injection point: "${point}"`);
    }
    if (list.some((e) => e.name === entry.name)) {
      this.logger.warn(`Duplicate injection "${entry.name}" in point "${point}", ignoring`);
      return () => {};
    }
    list.push(entry);
    const dispose = () => {
      const idx = list.indexOf(entry);
      if (idx >= 0) list.splice(idx, 1);
    };
    ctx.on("dispose", dispose);
    return dispose;
  }

  removeInjection(name: string): void {
    for (const list of this.injections.values()) {
      const idx = list.findIndex((e) => e.name === name);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  async render(templateName: string, initialScope?: Record<string, unknown>): Promise<Section[]> {
    const templateContent =
      this.config.templates?.[templateName] ?? this.templates.get(templateName);
    if (!templateContent) {
      this.logger.warn(`No template found for key "${templateName}"`);
      return [];
    }

    const scope = await this.buildScope(initialScope ?? {}, templateContent);
    const timeout = this.config.timeout ?? 5000;

    for (const point of INJECTION_POINTS) {
      const ordered = this.resolveOrder(this.injections.get(point)!);
      const results = await Promise.allSettled(
        ordered.map((entry) => this.renderWithTimeout(entry, scope, timeout)),
      );
      const fragments: string[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled" && r.value) {
          fragments.push(r.value);
        } else if (r.status === "rejected") {
          this.logger.warn(`Injection "${ordered[i].name}" in "${point}" failed: ${r.reason}`);
        }
      }
      const content = fragments.join("\n\n");
      if (content || !(`${point}_content` in scope)) {
        scope[`${point}_content`] = content;
        scope[`has_${point}`] = content.length > 0;
      }
    }

    const allPartials = {
      ...Object.fromEntries(this.templates),
      ...Object.fromEntries(this.partials),
    };

    const sections: Section[] = [];
    for (const point of INJECTION_POINTS) {
      const partialKey = point;
      const partialTemplate = allPartials[partialKey];
      if (!partialTemplate) {
        const content = scope[`${point}_content`] as string;
        if (content) {
          sections.push({ name: point, content, cacheable: CACHEABLE_POINTS.has(point) });
        }
        continue;
      }
      const rendered = this.renderer.render(partialTemplate, scope, allPartials);
      if (rendered.trim()) {
        sections.push({ name: point, content: rendered, cacheable: CACHEABLE_POINTS.has(point) });
      }
    }

    return sections;
  }

  async renderToString(
    templateName: string,
    initialScope?: Record<string, unknown>,
  ): Promise<string> {
    const sections = await this.render(templateName, initialScope);
    return sections.map((s) => s.content).join("\n\n");
  }

  private resolveOrder(entries: InjectionEntry[]): InjectionEntry[] {
    if (entries.length <= 1) return [...entries];

    const nameMap = new Map<string, InjectionEntry>();
    for (const e of entries) nameMap.set(e.name, e);

    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>();
    for (const e of entries) {
      inDegree.set(e.name, 0);
      graph.set(e.name, []);
    }

    for (const e of entries) {
      if (e.before && nameMap.has(e.before)) {
        graph.get(e.name)!.push(e.before);
        inDegree.set(e.before, (inDegree.get(e.before) ?? 0) + 1);
      }
      if (e.after && nameMap.has(e.after)) {
        graph.get(e.after)!.push(e.name);
        inDegree.set(e.name, (inDegree.get(e.name) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [name, deg] of inDegree) {
      if (deg === 0) queue.push(name);
    }

    const sorted: InjectionEntry[] = [];
    while (queue.length) {
      const name = queue.shift()!;
      sorted.push(nameMap.get(name)!);
      for (const next of graph.get(name)!) {
        const d = inDegree.get(next)! - 1;
        inDegree.set(next, d);
        if (d === 0) queue.push(next);
      }
    }

    if (sorted.length !== entries.length) {
      const missing = entries.filter((e) => !sorted.includes(e)).map((e) => e.name);
      this.logger.warn(
        `Cycle detected in injection ordering: [${missing.join(", ")}], using registration order`,
      );
      return [...entries];
    }

    return sorted;
  }

  private async renderWithTimeout(
    entry: InjectionEntry,
    scope: Record<string, unknown>,
    timeout: number,
  ): Promise<string> {
    return Promise.race([
      Promise.resolve(entry.renderFn(scope)).then((r) => r ?? ""),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout),
      ),
    ]);
  }

  private getRequiredVariables(templateContent: string): Set<string> {
    const visited = new Set<string>();
    const allVars = new Set<string>();
    const allPartials = {
      ...Object.fromEntries(this.templates),
      ...Object.fromEntries(this.partials),
    };

    const process = (content: string) => {
      const { variables, partials } = this.renderer.parse(content);
      for (const v of variables) allVars.add(v);
      for (const p of partials) {
        if (!visited.has(p)) {
          visited.add(p);
          const pc = allPartials[p];
          if (pc) process(pc);
        }
      }
    };

    process(templateContent);
    return allVars;
  }

  private isSnippetRequired(key: string, required: Set<string>): boolean {
    if (required.has(key)) return true;
    for (const req of required) {
      if (req.startsWith(`${key}.`) || key.startsWith(`${req}.`)) return true;
    }
    return false;
  }

  private async buildScope(
    initialScope: Record<string, unknown>,
    templateContent: string,
  ): Promise<Record<string, unknown>> {
    const required = this.getRequiredVariables(templateContent);
    const scope: Record<string, unknown> = { ...initialScope };
    for (const [key, fn] of this.snippets) {
      if (!this.isSnippetRequired(key, required)) continue;
      const result = await fn(scope);
      this.setNestedProperty(scope, key, result);
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

export const builtinResourcesDir = resolve(
  __dirname,
  "../".repeat(__dirname.includes("dist") ? 1 : 2),
  "resources/templates",
);
