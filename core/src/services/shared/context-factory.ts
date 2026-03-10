import type { Bot, Context, Session } from "koishi";

import type { HookExecutionContext, HookPhase, HookType } from "../hook/types";
import type { HorizonService } from "../horizon/service";
import type { HorizonView } from "../horizon/types";
import type { ToolExecutionContext } from "../plugin/types";
import {
  buildCapabilitiesFromRuntime,
  buildScenarioFromView,
  createRoundContext,
} from "../runtime/adapters";
import type { RoundContext, Scenario } from "../runtime/contracts";
import type { SkillRegistry } from "../skill/service";
import type { TraitAnalyzer } from "../trait/service";
import type { ActiveSkill, Percept, TraitSignal } from "./types";

export interface AgentRoundContextResult {
  toolCtx: ToolExecutionContext;
  roundContext: RoundContext;
}

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

export async function buildAgentRoundContext(
  ctx: Context,
  params: {
    platform: string;
    channelId: string;
    session?: Session;
    bot?: Bot;
    percept: Percept;
  },
): Promise<AgentRoundContextResult> {
  const toolCtx = await buildAgentContext(ctx, params);
  const scenario = buildScenarioFromView({
    view: toolCtx.view ?? createFallbackView(params),
    stimulusSource: buildStimulusSource(params.percept),
  });
  const capabilities = buildCapabilitiesFromRuntime({
    session: params.session,
    bot: params.bot,
  });
  const roundContext = createRoundContext({
    percept: params.percept,
    scenario,
    capabilities,
    metadata: {
      channelKey: `${params.platform}:${params.channelId}`,
      traceId: params.percept.traceId,
    },
    skillState: {
      active: (toolCtx.skills ?? []).map((skill) => skill.name),
    },
  });

  const runtimeAwareToolCtx = {
    ...toolCtx,
    scenario: roundContext.scenario,
    capabilities: roundContext.capabilities,
    roundContext,
  } as ToolExecutionContext;

  return {
    toolCtx: runtimeAwareToolCtx,
    roundContext,
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

function buildStimulusSource(percept: Percept): Scenario["raw"]["stimulusSource"] {
  const metadata = (percept.metadata ?? {}) as Record<string, unknown>;
  const rawType = metadata.stimulusType;
  const type: Scenario["raw"]["stimulusSource"]["type"] =
    rawType === "message" ||
    rawType === "event" ||
    rawType === "system" ||
    rawType === "timer" ||
    rawType === "internal"
      ? rawType
      : percept.type === "timer" || percept.type === "internal"
        ? percept.type
        : "message";

  return {
    type,
    messageId:
      typeof metadata.messageId === "string"
        ? metadata.messageId
        : typeof metadata.messageRef === "string"
          ? metadata.messageRef
          : undefined,
    senderId: typeof metadata.senderId === "string" ? metadata.senderId : undefined,
    triggerId: typeof metadata.triggerId === "string" ? metadata.triggerId : undefined,
    ref:
      metadata.sourceRef && typeof metadata.sourceRef === "object"
        ? (metadata.sourceRef as Record<string, unknown>)
        : undefined,
  };
}

function createFallbackView(params: {
  platform: string;
  channelId: string;
  bot?: Bot;
}): HorizonView {
  return {
    self: {
      id: params.bot?.selfId ?? "unknown-bot",
      name: params.bot?.user?.name ?? "assistant",
    },
    environment: {
      type: "unknown",
      id: params.channelId,
      name: params.channelId,
      platform: params.platform,
      channelId: params.channelId,
    },
    entities: [],
    history: [],
  };
}
