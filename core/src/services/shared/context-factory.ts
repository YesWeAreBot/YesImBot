import { isDeepStrictEqual } from "node:util";

import type { Bot, Context, Session } from "koishi";

import type { HookExecutionContext, HookPhase, HookType } from "../hook/types";
import type { HorizonService } from "../horizon/service";
import type { HorizonView } from "../horizon/types";
import type { ToolExecutionContext } from "../plugin/types";
import {
  bindCommittedRoundContext,
  buildCapabilitiesFromRuntime,
  buildScenarioFromView,
  commitRoundContext,
  createRoundContext,
} from "../runtime/adapters";
import type { RoundContext, Scenario } from "../runtime/contracts";
import type { TraitAnalyzer } from "../trait/service";
import type { ActiveSkill, Percept, TraitSignal } from "./types";

export interface AgentRoundContextResult {
  toolCtx: ToolExecutionContext;
  roundContext: RoundContext;
}

interface AgentRoundContextParams {
  platform: string;
  channelId: string;
  session?: Session;
  bot?: Bot;
  percept: Percept;
  toolCtx?: ToolExecutionContext;
}

interface RoundContextBaseline {
  percept: Percept;
  scenario: Scenario;
  capabilities: RoundContext["capabilities"];
  metadata: Record<string, unknown>;
  skillState: RoundContext["skillState"];
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
  const skills: ActiveSkill[] = [];

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
  params: AgentRoundContextParams,
): Promise<AgentRoundContextResult> {
  const toolCtx = await resolveAgentToolContext(ctx, params);
  const baseline = buildRoundContextBaseline(toolCtx, params);
  const roundContext = calibrateRoundContext(toolCtx.roundContext, baseline);

  const runtimeAwareToolCtx = bindCommittedRoundContext(
    {
      ...toolCtx,
      percept: params.percept,
    },
    roundContext,
  ) as ToolExecutionContext;

  return {
    toolCtx: runtimeAwareToolCtx,
    roundContext,
  };
}

async function resolveAgentToolContext(
  ctx: Context,
  params: AgentRoundContextParams,
): Promise<ToolExecutionContext> {
  const inboundToolCtx = params.toolCtx;
  const hasInboundRuntimeFields =
    inboundToolCtx?.view !== undefined &&
    inboundToolCtx?.traits !== undefined &&
    inboundToolCtx?.skills !== undefined;
  const builtToolCtx = hasInboundRuntimeFields ? undefined : await buildAgentContext(ctx, params);

  return {
    platform: params.platform,
    channelId: params.channelId,
    session: params.session ?? inboundToolCtx?.session ?? builtToolCtx?.session,
    bot: params.bot ?? inboundToolCtx?.bot ?? builtToolCtx?.bot,
    percept: params.percept,
    view: inboundToolCtx?.view ?? builtToolCtx?.view,
    traits: inboundToolCtx?.traits ?? builtToolCtx?.traits,
    skills: inboundToolCtx?.skills ?? builtToolCtx?.skills,
    roundContext: inboundToolCtx?.roundContext,
    scenario: inboundToolCtx?.scenario ?? builtToolCtx?.scenario,
    capabilities: inboundToolCtx?.capabilities ?? builtToolCtx?.capabilities,
  };
}

function buildRoundContextBaseline(
  toolCtx: ToolExecutionContext,
  params: AgentRoundContextParams,
): RoundContextBaseline {
  const normalizedView = normalizeViewForScenario(toolCtx.view, params);

  return {
    percept: params.percept,
    scenario: buildScenarioFromView({
      view: normalizedView,
      stimulusSource: buildStimulusSource(params.percept),
    }),
    capabilities: buildCapabilitiesFromRuntime({
      session: params.session ?? toolCtx.session,
      bot: params.bot ?? toolCtx.bot,
    }),
    metadata: {
      channelKey: `${params.platform}:${params.channelId}`,
      traceId: params.percept.traceId,
    },
    skillState: {
      active: (toolCtx.skills ?? []).map((skill) => skill.name),
    },
  };
}

function calibrateRoundContext(
  inboundRoundContext: RoundContext | undefined,
  baseline: RoundContextBaseline,
): RoundContext {
  if (!inboundRoundContext || !isSameRound(inboundRoundContext, baseline.percept)) {
    return createRoundContext(baseline);
  }

  const updates: Partial<
    Pick<RoundContext, "scenario" | "capabilities" | "metadata" | "skillState">
  > = {};

  if (!isDeepStrictEqual(inboundRoundContext.snapshot.scenario, baseline.scenario)) {
    updates.scenario = baseline.scenario;
  }
  if (!isDeepStrictEqual(inboundRoundContext.snapshot.capabilities, baseline.capabilities)) {
    updates.capabilities = baseline.capabilities;
  }
  if (!isDeepStrictEqual(inboundRoundContext.metadata, baseline.metadata)) {
    updates.metadata = baseline.metadata;
  }
  if (!isDeepStrictEqual(inboundRoundContext.skillState, baseline.skillState)) {
    updates.skillState = baseline.skillState;
  }

  if (Object.keys(updates).length === 0) {
    return inboundRoundContext;
  }

  return commitRoundContext(inboundRoundContext, updates);
}

function isSameRound(roundContext: RoundContext, percept: Percept): boolean {
  return (
    roundContext.percept.id === percept.id &&
    roundContext.percept.traceId === percept.traceId &&
    roundContext.percept.platform === percept.platform &&
    roundContext.percept.channelId === percept.channelId
  );
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

function normalizeViewForScenario(
  view: HorizonView | undefined,
  params: {
    platform: string;
    channelId: string;
    bot?: Bot;
  },
): HorizonView {
  const fallback = createFallbackView(params);
  if (!view) return fallback;

  return {
    self: view.self ?? fallback.self,
    environment: view.environment ?? fallback.environment,
    entities: Array.isArray(view.entities) ? view.entities : [],
    history: Array.isArray(view.history) ? view.history : [],
  };
}
