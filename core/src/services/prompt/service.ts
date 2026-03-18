import { createHash } from "node:crypto";

import { Context, Service } from "koishi";

import { HandlebarsRenderer } from "./renderer";
import type { PromptFragment, PromptSectionName, RenderedPromptSection, Snippet } from "./types";
import { PROMPT_FRAGMENT_SOURCE_PRECEDENCE, PROMPT_SECTION_LAYOUT } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.prompt": PromptService;
  }
}

export interface PromptServiceConfig {
  templates?: Record<string, string>;
  renderTimeout?: number;
  debugLevel?: number;
}

interface CanonicalPromptSection {
  name: PromptSectionName;
  content: string;
  cacheable: boolean;
  fragments: PromptFragment[];
}

export interface PromptEmitOptions {
  providerType?: string;
}

export interface PromptEmitBlocks {
  sections: RenderedPromptSection[];
  stableBlock: string;
  dynamicBlock: string;
  stableSignature: string;
}

export class PromptService extends Service<PromptServiceConfig> {
  private fragmentSources = new Map<
    string,
    (scope: Record<string, unknown>) => PromptFragment[] | Promise<PromptFragment[]>
  >();
  private snippets = new Map<string, Snippet>();
  private partials = new Map<string, string>();
  private renderer = new HandlebarsRenderer();

  constructor(ctx: Context, config: PromptServiceConfig) {
    super(ctx, "yesimbot.prompt", true);
    this.config = config;
    this.logger = this.ctx.logger("yesimbot.prompt");
    this.logger.level = config.debugLevel ?? 2;
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

  async render(
    _templateName: string,
    initialScope?: Record<string, unknown>,
  ): Promise<RenderedPromptSection[]> {
    const scope = await this.buildScope(initialScope ?? {});
    return this.renderCanonicalLayout(scope);
  }

  async renderCanonicalLayout(scope: Record<string, unknown>): Promise<RenderedPromptSection[]> {
    const collected = await this.collectFragments(scope);
    const validated = collected.map((fragment) => this.validateFragment(fragment));
    const canonicalSections = this.buildCanonicalSections(validated);
    return canonicalSections.map((section) => ({
      name: section.name,
      content: section.content,
      cacheable: section.cacheable,
    }));
  }

  async emitPromptBlocks(
    _templateName: string,
    initialScope?: Record<string, unknown>,
    _options?: PromptEmitOptions,
  ): Promise<PromptEmitBlocks> {
    const scope = await this.buildScope(initialScope ?? {});
    const collected = await this.collectFragments(scope);
    const validated = collected.map((fragment) => this.validateFragment(fragment));
    const canonicalSections = this.buildCanonicalSections(validated);

    const sections: RenderedPromptSection[] = canonicalSections.map((section) => ({
      name: section.name,
      content: section.content,
      cacheable: section.cacheable,
    }));
    const stableSections = canonicalSections.filter((section) => section.cacheable);
    const dynamicSections = canonicalSections.filter((section) => !section.cacheable);

    const stableBlock = stableSections.map((section) => section.content).join("\n\n");
    const dynamicBlock = dynamicSections.map((section) => section.content).join("\n\n");
    const stableSignature = this.buildStableSignature(stableSections);

    return {
      sections,
      stableBlock,
      dynamicBlock,
      stableSignature,
    };
  }

  async renderToString(
    templateName: string,
    initialScope?: Record<string, unknown>,
  ): Promise<string> {
    const sections = await this.render(templateName, initialScope);
    return sections.map((s) => s.content).join("\n\n");
  }

  private async collectFragments(scope: Record<string, unknown>): Promise<PromptFragment[]> {
    const fragments: PromptFragment[] = [];

    for (const [sourceName, provider] of this.fragmentSources) {
      const provided = await provider(scope);
      if (!Array.isArray(provided)) {
        throw new Error(`fragment source "${sourceName}" must return PromptFragment[]`);
      }
      fragments.push(...provided);
    }

    return fragments;
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

  private buildCanonicalSections(fragments: PromptFragment[]): CanonicalPromptSection[] {
    const idSet = new Set<string>();
    for (const fragment of fragments) {
      if (idSet.has(fragment.id)) {
        throw new Error(`duplicate fragment id: "${fragment.id}"`);
      }
      idSet.add(fragment.id);
    }

    const sections: CanonicalPromptSection[] = [];
    for (const sectionName of PROMPT_SECTION_LAYOUT) {
      const sectionFragments = fragments
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
        fragments: sectionFragments,
      });
    }

    return sections;
  }

  private buildStableSignature(sections: CanonicalPromptSection[]): string {
    const orderedStableFragments = sections.flatMap((section) =>
      section.fragments.map((fragment) => {
        const contentHash = createHash("sha256").update(fragment.content).digest("hex");
        return `${section.name}:${fragment.id}:${contentHash}`;
      }),
    );

    return createHash("sha256").update(orderedStableFragments.join("|"), "utf8").digest("hex");
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
