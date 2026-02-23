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

    // Resolve resources directory; seed from builtin if custom dir lacks core-memory template
    this.resourcesDir = config.resourcesDir ?? builtinResourcesDir;
    if (
      this.resourcesDir !== builtinResourcesDir &&
      !existsSync(resolve(this.resourcesDir, "core-memory.mustache"))
    ) {
      cpSync(builtinResourcesDir, this.resourcesDir, { recursive: true });
      this.logger.info(`Seeded templates to "${this.resourcesDir}"`);
    }

    for (const point of INJECTION_POINTS) {
      this.injections.set(point, []);
    }

    // Register only retained partials (used by MemoryService and HorizonService)
    for (const name of ["memory-block", "horizon-view"] as const) {
      this.registerPartial(name, this.loadPartial(name));
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

  async render(_templateName: string, initialScope?: Record<string, unknown>): Promise<Section[]> {
    const scope = await this.buildScope(initialScope ?? {});
    const timeout = this.config.timeout ?? 5000;
    const sections: Section[] = [];

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
      sections.push({
        name: point,
        content: `<${point}>\n${content}\n</${point}>`,
        cacheable: true,
      });
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

  private async buildScope(
    initialScope: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const scope: Record<string, unknown> = { ...initialScope };
    for (const [key, fn] of this.snippets) {
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
