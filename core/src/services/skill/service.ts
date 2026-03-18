import { existsSync } from "node:fs";
import { join } from "node:path";

import { Context, Schema, Service } from "koishi";

import { loadSkillsFromDir } from "./loader";
import type { SkillDefinition } from "./types";

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

const builtinSkillsDir = join(
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
