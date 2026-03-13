import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { Context, Schema, Service } from "koishi";

import type { ChannelKey, TraitSignal } from "../shared/types";
import { evaluateCondition, filterByConfidence, specificity } from "./condition";
import { loadSkillsFromDir } from "./loader";
import {
  mapSectionToLegacyPoint,
  normalizePromptMetadata,
  normalizeStyleMetadata,
} from "./normalize";
import type { SkillDefinition, SkillEffect } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.skill": SkillRegistry;
  }
}

export interface SkillRegistryConfig {
  skillPaths?: string[];
  confidenceThreshold?: number;
  stickyDefaultTimeout?: number;
}

export const SkillRegistryConfigSchema: Schema<SkillRegistryConfig> = Schema.object({
  skillPaths: Schema.array(Schema.path({ filters: ["directory"], allowCreate: true })).default([]),
  confidenceThreshold: Schema.number().default(0.3),
  stickyDefaultTimeout: Schema.number().default(3),
});

const builtinSkillsDir = resolve(
  __dirname,
  "../".repeat(__dirname.includes("dist") ? 1 : 2),
  "resources/skills",
);

export class SkillRegistry extends Service<SkillRegistryConfig> {
  private skills = new Map<string, SkillDefinition>();

  constructor(ctx: Context, config: SkillRegistryConfig) {
    super(ctx, "yesimbot.skill", false);
    this.config = config;
    this.logger = ctx.logger("skill");
  }

  protected async start(): Promise<void> {
    await this.loadAllDirs();
    this.logger.info("SkillRegistry started, %d skills loaded", this.skills.size);
  }

  register(def: SkillDefinition): () => void {
    this.skills.set(def.name, def);
    const dispose = () => {
      this.skills.delete(def.name);
    };
    this.ctx.on("dispose", dispose);
    return dispose;
  }

  async reload(): Promise<void> {
    for (const [k, v] of this.skills) {
      if (v.source === "file") this.skills.delete(k);
    }
    await this.loadAllDirs();
    this.logger.info("Skills reloaded, %d skills", this.skills.size);
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  all(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /** @deprecated Use explicit loadSkill() and SkillEffectApplier. */
  resolve(signals: TraitSignal[], key: ChannelKey): SkillEffect {
    const filtered = filterByConfidence(signals, this.config.confidenceThreshold ?? 0.3);
    this.logger.info(
      "resolve signals: %o",
      filtered.map((s) => ({ d: s.dimension, v: s.value, meta: s.metadata })),
    );
    this.logger.warn(
      "SkillRegistry.resolve() is deprecated for %s:%s; migrate to loadSkill() + SkillEffectApplier",
      key.platform,
      key.channelId,
    );

    const active: SkillDefinition[] = [];

    for (const skill of this.skills.values()) {
      const activated = skill.activate
        ? skill.activate(filtered)
        : skill.conditions
          ? evaluateCondition(skill.conditions, filtered)
          : false;
      this.logger.info(
        "skill %s: hasActivate=%s, hasCond=%s, activated=%s",
        skill.name,
        !!skill.activate,
        !!skill.conditions,
        activated,
      );

      if (activated) {
        active.push(skill);
        this.logger.info("skill %s activated (lifecycle: %s)", skill.name, skill.lifecycle);
      }
    }

    return this.mergeEffects(active);
  }

  /** @deprecated Compatibility helper for resolve(). */
  private mergeEffects(active: SkillDefinition[]): SkillEffect {
    // Sort by specificity descending for prompt injection ordering
    const sorted = [...active].sort((a, b) => {
      const specA = a.conditions ? specificity(a.conditions) : 0;
      const specB = b.conditions ? specificity(b.conditions) : 0;
      return specB - specA;
    });

    const result: SkillEffect = {
      promptFragments: [],
      styleFragment: null,
      promptInjections: [],
      styleOverride: null,
      toolFilter: { include: [], exclude: [] },
      activeSkills: sorted.map((s) => ({
        name: s.name,
        effects: [
          ...(s.effects.prompt ? ["prompt"] : []),
          ...(s.effects.style ? ["style"] : []),
          ...(s.effects.tools ? ["tools"] : []),
        ],
        metadata: { description: s.description },
      })),
    };

    let bestStyle: (SkillEffect["styleFragment"] & { specificity: number }) | null = null;

    for (const skill of sorted) {
      if (skill.effects.prompt) {
        const promptMeta = normalizePromptMetadata(skill);
        result.promptFragments.push({
          skillName: skill.name,
          section: promptMeta.section,
          source: "skill",
          stability: promptMeta.stability,
          priority: promptMeta.priority,
          cacheable: promptMeta.cacheable,
          content: `<skill name="${skill.name}">${skill.effects.prompt}</skill>`,
        });
        result.promptInjections?.push({
          skillName: skill.name,
          point: mapSectionToLegacyPoint(promptMeta.section),
          content: `<skill name="${skill.name}">${skill.effects.prompt}</skill>`,
        });
      }

      if (skill.effects.style) {
        const spec = skill.conditions ? specificity(skill.conditions) : 0;
        const styleMeta = normalizeStyleMetadata(skill);
        if (!bestStyle || spec >= bestStyle.specificity) {
          bestStyle = {
            skillName: skill.name,
            content: skill.effects.style.content,
            section: styleMeta.section,
            source: "skill",
            stability: styleMeta.stability,
            priority: styleMeta.priority,
            cacheable: styleMeta.cacheable,
            specificity: spec,
          };
        }
      }

      if (skill.effects.tools) {
        if (skill.effects.tools.include) {
          result.toolFilter.include.push(...skill.effects.tools.include);
        }
        if (skill.effects.tools.exclude) {
          result.toolFilter.exclude.push(...skill.effects.tools.exclude);
        }
      }
    }

    result.styleFragment = bestStyle;
    if (bestStyle) {
      result.styleOverride = {
        content: bestStyle.content,
        specificity: bestStyle.specificity,
        point: mapSectionToLegacyPoint(bestStyle.section),
      };
    }
    return result;
  }

  private async loadAllDirs(): Promise<void> {
    if (existsSync(builtinSkillsDir)) {
      const builtins = loadSkillsFromDir(builtinSkillsDir);
      for (const s of builtins) this.skills.set(s.name, s);
    }
    for (const dir of this.config.skillPaths ?? []) {
      if (!existsSync(dir)) continue;
      const loaded = await loadSkillsFromDir(dir);
      for (const s of loaded) this.skills.set(s.name, s);
    }
  }
}
