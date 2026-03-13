import { cpSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Context, Schema, Service } from "koishi";

import { HandlebarsRenderer } from "./renderer";
import type {
  InjectionEntry,
  InjectionPoint,
  PromptFragment,
  PromptSectionName,
  Section,
  Snippet,
} from "./types";
import {
  INJECTION_POINTS,
  LEGACY_INJECTION_POINT_SECTION_MAPPING,
  PROMPT_FRAGMENT_SOURCE_PRECEDENCE,
  PROMPT_SECTION_LAYOUT,
} from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.prompt": PromptService;
  }
}

export interface PromptServiceConfig {
  templates?: Record<string, string>;
  renderTimeout?: number;
}

export const PromptServiceConfigSchema: Schema<PromptServiceConfig> = Schema.object({
  templates: Schema.dict(Schema.string()),
  renderTimeout: Schema.number().default(5000),
});

export class PromptService extends Service<PromptServiceConfig> {
  private fragmentSources = new Map<
    string,
    (scope: Record<string, unknown>) => PromptFragment[] | Promise<PromptFragment[]>
  >();
  private snippets = new Map<string, Snippet>();
  private injections = new Map<InjectionPoint, InjectionEntry[]>();
  private partials = new Map<string, string>();
  private renderer = new HandlebarsRenderer();
  private warnedLegacyInject = false;

  constructor(ctx: Context, config: PromptServiceConfig) {
    super(ctx, "yesimbot.prompt", true);
    this.config = config;
    this.logger = this.ctx.logger("yesimbot.prompt");

    for (const point of INJECTION_POINTS) {
      this.injections.set(point, []);
    }
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

  registerFragmentSource(
    name: string,
    provider: (scope: Record<string, unknown>) => PromptFragment[] | Promise<PromptFragment[]>,
  ): () => void {
    if (this.fragmentSources.has(name)) {
      throw new Error(`duplicate fragment source registration: "${name}"`);
    }

    this.fragmentSources.set(name, provider);
    const dispose = () => {
      this.fragmentSources.delete(name);
    };
    return dispose;
  }

  inject(ctx: Context, point: InjectionPoint, entry: InjectionEntry): () => void {
    if (!this.warnedLegacyInject) {
      this.warnedLegacyInject = true;
      this.logger.warn("prompt.inject() is deprecated; register fragment sources instead");
    }

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
    return this.renderCanonicalLayout(scope);
  }

  async renderCanonicalLayout(scope: Record<string, unknown>): Promise<Section[]> {
    const timeout = this.config.renderTimeout ?? 5000;
    const collected = await this.collectFragments(scope, timeout);
    const validated = collected.map((fragment) => this.validateFragment(fragment));

    const idSet = new Set<string>();
    for (const fragment of validated) {
      if (idSet.has(fragment.id)) {
        throw new Error(`duplicate fragment id: "${fragment.id}"`);
      }
      idSet.add(fragment.id);
    }

    const sections: Section[] = [];
    for (const sectionName of PROMPT_SECTION_LAYOUT) {
      const sectionFragments = validated
        .filter((fragment) => fragment.section === sectionName)
        .sort((a, b) => this.compareFragments(a, b));

      if (sectionFragments.length === 0) {
        continue;
      }

      const content = sectionFragments.map((fragment) => fragment.content).join("\n\n");
      sections.push({
        name: sectionName,
        content: `<${sectionName}>\n${content}\n</${sectionName}>`,
        cacheable: sectionFragments.every(
          (fragment) => fragment.stability === "stable" && fragment.cacheable !== false,
        ),
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

  private async collectFragments(
    scope: Record<string, unknown>,
    timeout: number,
  ): Promise<PromptFragment[]> {
    const fragments: PromptFragment[] = [];

    for (const [sourceName, provider] of this.fragmentSources) {
      const provided = await provider(scope);
      if (!Array.isArray(provided)) {
        throw new Error(`fragment source "${sourceName}" must return PromptFragment[]`);
      }
      fragments.push(...provided);
    }

    for (const point of INJECTION_POINTS) {
      const entries = this.injections.get(point) ?? [];
      for (const entry of entries) {
        const content = await this.renderWithTimeout(entry, scope, timeout);
        if (!content) {
          continue;
        }
        const section = this.resolveLegacySection(point, entry.legacySectionHint);
        fragments.push({
          id: entry.name,
          content,
          section,
          source: "legacy",
          priority: 0,
          stability: section === "situation" ? "dynamic" : "stable",
          cacheable: section !== "situation",
        });
      }
    }

    return fragments;
  }

  private resolveLegacySection(
    point: InjectionPoint,
    legacySectionHint?: InjectionEntry["legacySectionHint"],
  ): PromptSectionName {
    if (point === "extra") {
      return legacySectionHint ?? LEGACY_INJECTION_POINT_SECTION_MAPPING.extra;
    }
    return LEGACY_INJECTION_POINT_SECTION_MAPPING[point];
  }

  private compareFragments(a: PromptFragment, b: PromptFragment): number {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }

    const sourceRankA = PROMPT_FRAGMENT_SOURCE_PRECEDENCE.indexOf(a.source);
    const sourceRankB = PROMPT_FRAGMENT_SOURCE_PRECEDENCE.indexOf(b.source);
    if (sourceRankA !== sourceRankB) {
      return sourceRankA - sourceRankB;
    }

    return a.id.localeCompare(b.id);
  }

  private validateFragment(fragment: PromptFragment): PromptFragment {
    if (!fragment.id || typeof fragment.id !== "string" || fragment.id.trim().length === 0) {
      throw new Error("fragment id is required");
    }

    if (!PROMPT_SECTION_LAYOUT.includes(fragment.section)) {
      throw new Error(`unknown section: "${String(fragment.section)}"`);
    }

    if (!PROMPT_FRAGMENT_SOURCE_PRECEDENCE.includes(fragment.source)) {
      throw new Error(`unknown fragment source: "${String(fragment.source)}"`);
    }

    if (!Number.isFinite(fragment.priority)) {
      throw new Error(`invalid fragment priority for "${fragment.id}"`);
    }

    if (fragment.stability !== "stable" && fragment.stability !== "dynamic") {
      throw new Error(`invalid fragment stability for "${fragment.id}"`);
    }

    if (fragment.stability === "dynamic" && fragment.cacheable === true) {
      throw new Error(`dynamic fragment cannot set cacheable=true: "${fragment.id}"`);
    }

    return {
      ...fragment,
      id: fragment.id.trim(),
      cacheable:
        fragment.cacheable === undefined ? fragment.stability === "stable" : fragment.cacheable,
    };
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
