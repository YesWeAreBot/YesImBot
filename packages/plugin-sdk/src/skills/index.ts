import type { Context } from "koishi";

export {
  type SkillDefinition,
  type SkillMetadata,
  loadSkillsFromDir,
  SkillRegistry,
} from "koishi-plugin-yesimbot/services/skill";

export {
  CAPABILITY_KEYS,
  getCapabilityByKey,
  type Capabilities,
  type CapabilityState,
  type CapabilityResolver,
} from "koishi-plugin-yesimbot/services/plugin";

interface SkillRuntimeRegistrar {
  register(def: import("koishi-plugin-yesimbot/services/skill").SkillDefinition): () => void;
  registerDir(dir: string, source: "plugin" | "file"): Array<() => void>;
}

type SkillRuntimeContext = Context & {
  "yesimbot.skill"?: SkillRuntimeRegistrar;
};

export function registerSkill(
  ctx: Context,
  def: import("koishi-plugin-yesimbot/services/skill").SkillDefinition,
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
