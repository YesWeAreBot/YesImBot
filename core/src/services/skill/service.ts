import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { Context, Schema, Service } from "koishi";

import type { InjectionPoint } from "../prompt/types";
import type { Scope, TraitSignal } from "../shared/types";
import { evaluateCondition, filterByConfidence, specificity } from "./condition";
import { loadSkillsFromDir } from "./loader";
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

interface ActiveSkillState {
  lifecycle: SkillDefinition["lifecycle"];
  roundsSinceActive: number;
  stickyTimeout: number;
}

const builtinSkillsDir = resolve(
  __dirname,
  "../".repeat(__dirname.includes("dist") ? 1 : 2),
  "resources/skills",
);

export class SkillRegistry extends Service<SkillRegistryConfig> {
  static inject = ["yesimbot.trait"];

  private skills = new Map<string, SkillDefinition>();
  private channelState = new Map<string, Map<string, ActiveSkillState>>();

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
    this[Context.current]?.on("dispose", dispose);
    return dispose;
  }

  async reload(): Promise<void> {
    for (const [k, v] of this.skills) {
      if (v.source === "file") this.skills.delete(k);
    }
    await this.loadAllDirs();
    this.logger.info("Skills reloaded, %d skills", this.skills.size);
  }

  resolve(signals: TraitSignal[], scope: Scope): SkillEffect {
    const filtered = filterByConfidence(signals, this.config.confidenceThreshold ?? 0.3);
    this.logger.info(
      "resolve signals: %o",
      filtered.map((s) => ({ d: s.dimension, v: s.value, meta: s.metadata })),
    );
    const channelKey = `${scope.platform}:${scope.channelId}`;
    if (!this.channelState.has(channelKey)) {
      this.channelState.set(channelKey, new Map());
    }
    const state = this.channelState.get(channelKey)!;

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
        if (skill.lifecycle === "sticky") {
          state.set(skill.name, {
            lifecycle: "sticky",
            roundsSinceActive: 0,
            stickyTimeout: skill.stickyTimeout ?? this.config.stickyDefaultTimeout ?? 3,
          });
        } else if (skill.lifecycle === "trait-bound") {
          state.set(skill.name, {
            lifecycle: "trait-bound",
            roundsSinceActive: 0,
            stickyTimeout: 0,
          });
        }
      } else if (skill.lifecycle === "sticky" && state.has(skill.name)) {
        const s = state.get(skill.name)!;
        s.roundsSinceActive++;
        if (s.roundsSinceActive >= s.stickyTimeout) {
          state.delete(skill.name);
        } else {
          active.push(skill);
        }
      } else if (skill.lifecycle === "trait-bound" && state.has(skill.name)) {
        // Trait signal gone -> immediate removal, no grace period
        state.delete(skill.name);
        this.logger.info("trait-bound skill %s deactivated (trait signal lost)", skill.name);
      }
    }

    return this.mergeEffects(active);
  }

  private mergeEffects(active: SkillDefinition[]): SkillEffect {
    // Sort by specificity descending for prompt injection ordering
    const sorted = [...active].sort((a, b) => {
      const specA = a.conditions ? specificity(a.conditions) : 0;
      const specB = b.conditions ? specificity(b.conditions) : 0;
      return specB - specA;
    });

    const result: SkillEffect = {
      promptInjections: [],
      styleOverride: null,
      toolFilter: { include: [], exclude: [] },
    };

    let bestStyle: {
      content: string;
      specificity: number;
      point: InjectionPoint;
    } | null = null;

    for (const skill of sorted) {
      if (skill.effects.prompt) {
        result.promptInjections.push({
          skillName: skill.name,
          point: skill.injectionPoint ?? "extra",
          content: `<skill name="${skill.name}">${skill.effects.prompt}</skill>`,
        });
      }

      if (skill.effects.style) {
        const spec = skill.conditions ? specificity(skill.conditions) : 0;
        if (!bestStyle || spec >= bestStyle.specificity) {
          bestStyle = {
            content: skill.effects.style.content,
            specificity: spec,
            point: skill.styleInjectionPoint ?? "soul",
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

    result.styleOverride = bestStyle;
    return result;
  }

  private async loadAllDirs(): Promise<void> {
    if (existsSync(builtinSkillsDir)) {
      const builtins = await loadSkillsFromDir(builtinSkillsDir, this.logger);
      for (const s of builtins) this.skills.set(s.name, s);
    }
    for (const dir of this.config.skillPaths ?? []) {
      if (!existsSync(dir)) continue;
      const loaded = await loadSkillsFromDir(dir, this.logger);
      for (const s of loaded) this.skills.set(s.name, s);
    }
  }
}
