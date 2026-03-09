import type { Bot, Context, Session } from "koishi";

import type { HookExecutionContext, HookPhase, HookType } from "../hook/types";
import type { HorizonService } from "../horizon/service";
import type { HorizonView } from "../horizon/types";
import type { ToolExecutionContext } from "../plugin/types";
import type { SkillRegistry } from "../skill/service";
import type { TraitAnalyzer } from "../trait/service";
import type { ActiveSkill, Percept, TraitSignal } from "./types";

export function buildMinimalContext(params: {
  platform: string;
  channelId: string;
  session?: Session;
  bot?: Bot;
}): ToolExecutionContext {
  const context: ToolExecutionContext = {
    platform: params.platform,
    channelId: params.channelId,
  };
  if (params.session) context.session = params.session;
  if (params.bot) context.bot = params.bot;
  return context;
}

export async function buildAgentContext(
  ctx: Context,
  params: {
    platform: string;
    channelId: string;
    session?: Session;
    bot?: Bot;
    percept: Percept;
  },
): Promise<ToolExecutionContext> {
  const logger = ctx.logger("context-factory");
  const key = { platform: params.platform, channelId: params.channelId };
  const missingFields: string[] = [];

  let view: HorizonView | undefined;
  try {
    const horizonService = ctx["yesimbot.horizon"] as HorizonService;
    view = await horizonService.buildView(key, {
      session: params.session,
      selfId: params.bot?.selfId,
      selfName: params.bot?.user?.name,
    });
  } catch (err) {
    missingFields.push("view");
    logger.warn(
      `[${params.percept.traceId}] ToolExecutionContext incomplete: failed to build view — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let traits: TraitSignal[] = [];
  let skills: ActiveSkill[] = [];

  if (view) {
    try {
      const traitAnalyzer = ctx["yesimbot.trait"] as TraitAnalyzer;
      traits = await traitAnalyzer.analyze(key, view);
    } catch (err) {
      missingFields.push("traits");
      logger.warn(
        `[${params.percept.traceId}] ToolExecutionContext incomplete: failed to analyze traits — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      const skillRegistry = ctx["yesimbot.skill"] as SkillRegistry;
      const effects = skillRegistry.resolve(traits, key);
      skills = effects.activeSkills;
    } catch (err) {
      missingFields.push("skills");
      logger.warn(
        `[${params.percept.traceId}] ToolExecutionContext incomplete: failed to resolve skills — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (missingFields.length > 0) {
    logger.warn(
      `[${params.percept.traceId}] ToolExecutionContext incomplete: missing fields [${missingFields.join(", ")}] at buildAgentContext()`,
    );
  }

  return {
    platform: params.platform,
    channelId: params.channelId,
    session: params.session,
    bot: params.bot,
    percept: params.percept,
    view,
    traits,
    skills,
  };
}

export function buildHookContext(
  toolCtx: ToolExecutionContext,
  hookType: HookType,
  hookPhase: HookPhase,
): HookExecutionContext {
  return {
    ...toolCtx,
    hookType,
    hookPhase,
  };
}
