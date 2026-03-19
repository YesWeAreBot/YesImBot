declare module "koishi-plugin-yesimbot/services/skill" {
  export type SkillResourceMap = Record<string, string>;

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

  export function loadSkillsFromDir(dir: string): Promise<SkillDefinition[]>;

  export class SkillRegistry {
    register(def: SkillDefinition): () => void;
    get(name: string): SkillDefinition | undefined;
    all(): SkillDefinition[];
    loadAllDirs(): Promise<void>;
  }
}

declare module "koishi-plugin-yesimbot/services/plugin" {
  export interface CapabilityResolver {
    readonly platform?: string;
    readonly resolver: (params: {
      session?: { isDirect?: boolean; quote?: unknown; guildId?: string };
      scenario?: unknown;
      bot?: { selfId?: string };
    }) => Record<string, CapabilityState>;
  }
}
