import type { Context } from "koishi";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type CapabilityState =
  | {
      status: "available";
      detail?: string;
      limits?: Record<string, unknown>;
      source?: string;
    }
  | {
      status: "unavailable";
      reason: string;
      recoverable?: boolean;
      detail?: string;
      source?: string;
    };

export interface Capabilities {
  core: Record<string, CapabilityState>;
  extended: Record<string, CapabilityState>;
}

export const CAPABILITY_KEYS = {
  MESSAGE_SEND: "message.send",
  MESSAGE_REPLY: "message.reply",
  MESSAGE_DELETE: "message.delete",
  MESSAGE_READ_HISTORY: "message.read_history",
  MESSAGE_DIRECT: "message.direct",
  MEMBER_MODERATE: "member.moderate",
  SOCIAL_ESSENCE: "social.essence",
  SOCIAL_REACTION: "social.reaction",
  PLATFORM_SESSION: "platform.session",
} as const;

export function getCapabilityByKey(
  capabilities: Capabilities | undefined,
  key: string,
): CapabilityState | undefined {
  if (!capabilities) {
    return undefined;
  }
  return capabilities.core[key] ?? capabilities.extended[key];
}

export interface CapabilityResolver {
  readonly platform?: string;
  readonly resolver: (params: {
    session?: { isDirect?: boolean; quote?: unknown; guildId?: string };
    scenario?: unknown;
    bot?: { selfId?: string };
  }) => Record<string, CapabilityState>;
}

export interface SkillResourceReference {
  path: string;
  description?: string;
}

export type SkillResourceMap = Record<string, SkillResourceReference>;

export interface SkillDefinition {
  name: string;
  description: string;
  guidance: string;
  allowedTools?: string[];
  resources?: SkillResourceMap;
  rootDir: string;
  source: "file" | "plugin";
}

export interface SkillMetadata {
  name: string;
  description: string;
  allowedTools?: string[];
  resources?: SkillResourceMap;
}

export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>();

  register(def: SkillDefinition): () => void {
    this.skills.set(def.name, def);
    return () => {
      this.skills.delete(def.name);
    };
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  all(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  registerDir(dir: string, source: "plugin" | "file"): Array<() => void> {
    const loaded = loadSkillsFromDir(dir);
    return loaded.map((def) =>
      this.register({
        ...def,
        source,
      }),
    );
  }
}

export function loadSkillsFromDir(dir: string): SkillDefinition[] {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = readdirSync(dir, { withFileTypes: true });
  const result: SkillDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillDir = join(dir, entry.name);
    const skillMdPath = join(skillDir, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      continue;
    }

    const guidance = readFileSync(skillMdPath, "utf-8").trim();
    result.push({
      name: entry.name,
      description: "",
      guidance,
      rootDir: skillDir,
      source: "file",
    });
  }

  return result;
}

interface SkillRuntimeRegistrar {
  register(def: SkillDefinition): () => void;
  registerDir(dir: string, source: "plugin" | "file"): Array<() => void>;
  all?(): SkillDefinition[];
}

type SkillRuntimeContext = Context & {
  "yesimbot.skill"?: SkillRuntimeRegistrar;
};

export function registerSkill(
  ctx: Context,
  def: SkillDefinition,
): () => void {
  const skillService = (ctx as SkillRuntimeContext)["yesimbot.skill"];
  if (!skillService) {
    throw new Error("yesimbot.skill service is not available on context");
  }

  return skillService.register(def);
}

export function registerSkillPack(ctx: Context, dir: string): Array<() => void> {
  const skillService = (ctx as SkillRuntimeContext)["yesimbot.skill"];
  if (!skillService) {
    throw new Error("yesimbot.skill service is not available on context");
  }

  return skillService.registerDir(dir, "plugin");
}
