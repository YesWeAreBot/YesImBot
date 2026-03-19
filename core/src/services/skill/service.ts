import { existsSync } from "node:fs";
import { join } from "node:path";

import { Context, Service } from "koishi";

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
  debugLevel?: number;
}

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
    this.logger.level = config.debugLevel ?? 2;
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

  registerDir(dir: string, source: "plugin" | "file"): Array<() => void> {
    if (!existsSync(dir)) {
      return [];
    }

    const loaded = loadSkillsFromDir(dir);
    return loaded.map((def) =>
      this.register({
        ...def,
        source,
      }),
    );
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

  async loadAllDirs(): Promise<void> {
    if (existsSync(builtinSkillsDir)) {
      const builtins = loadSkillsFromDir(builtinSkillsDir);
      for (const s of builtins) this.skills.set(s.name, s);
    }
    for (const dir of this.config.skillPaths ?? []) {
      if (!existsSync(dir)) continue;
      const loaded = loadSkillsFromDir(dir);
      for (const s of loaded) this.skills.set(s.name, s);
    }
  }
}
