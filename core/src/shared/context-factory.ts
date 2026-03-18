import { isDeepStrictEqual } from "node:util";

import type { Bot, Context, Session } from "koishi";

import {
  bindCommittedRoundContext,
  buildCapabilitiesFromRuntime,
  buildScenarioFromView,
  commitRoundContext,
  createRoundContext,
} from "../runtime/adapters";
import type { CapabilityState, Percept, RoundContext, Scenario } from "../runtime/contracts";
import type { HookExecutionContext, HookPhase, HookType } from "../services/hook/types";
import type { HorizonService } from "../services/horizon/service";
import type { HorizonView } from "../services/horizon/types";
import type { ToolExecutionContext } from "../services/plugin/types";
import type { SkillRegistry } from "../services/skill/service";
import { AgentSessionStore, projectSkillState } from "../services/skill/session-store";
import type { SkillDefinition } from "../services/skill/types";
import type { ActiveSkill, TraitSignal } from "./types";

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
  resolvers?: Array<
    (params: {
      session?: Pick<Session, "isDirect" | "quote" | "guildId">;
      scenario?: Scenario;
      bot?: Pick<Bot, "selfId">;
    }) => Record<string, CapabilityState>
  >;
}

interface RoundContextBaseline {
  percept: Percept;
  scenario: Scenario;
  capabilities: RoundContext["capabilities"];
  metadata: Record<string, unknown>;
  skillState: RoundContext["skillState"];
}

export function projectActiveSkills(
  loadedSkillNames: string[] | undefined,
  catalog?: Pick<SkillRegistry, "get">,
): ActiveSkill[] {
  if (!loadedSkillNames?.length || !catalog) {
    return [];
  }

  return loadedSkillNames.flatMap((skillName) => {
    const definition = catalog.get(skillName);
    return definition ? [toActiveSkill(definition)] : [];
  });
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
  const sessionStore = ctx["yesimbot.session"] as AgentSessionStore | undefined;
  const skillCatalog = ctx["yesimbot.skill"] as SkillRegistry | undefined;
  const sessionState = sessionStore?.getState(params.platform, params.channelId);
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

  const traits: TraitSignal[] = []; // Internal legacy compatibility — always empty in no-Trait path
  const skills = projectActiveSkills(sessionState?.loadedSkills, skillCatalog);
  const normalizedView = normalizeViewForScenario(view, {
    platform: params.platform,
    channelId: params.channelId,
    bot: params.bot,
  });
  const scenario = buildScenarioFromView({
    view: normalizedView,
    stimulusSource: buildStimulusSource(params.percept),
  });

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
    traits,
    skills,
    scenario,
  };
}

export async function buildAgentRoundContext(
  ctx: Context,
  params: AgentRoundContextParams,
): Promise<AgentRoundContextResult> {
  const toolCtx = await resolveAgentToolContext(ctx, params);
  const baseline = buildRoundContextBaseline(ctx, toolCtx, params);
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
    inboundToolCtx?.scenario !== undefined &&
    inboundToolCtx?.traits !== undefined &&
    inboundToolCtx?.skills !== undefined;
  const builtToolCtx = hasInboundRuntimeFields ? undefined : await buildAgentContext(ctx, params);

  return {
    platform: params.platform,
    channelId: params.channelId,
    session: params.session ?? inboundToolCtx?.session ?? builtToolCtx?.session,
    bot: params.bot ?? inboundToolCtx?.bot ?? builtToolCtx?.bot,
    percept: params.percept,
    traits: inboundToolCtx?.traits ?? builtToolCtx?.traits,
    skills: inboundToolCtx?.skills ?? builtToolCtx?.skills,
    roundContext: inboundToolCtx?.roundContext,
    scenario: inboundToolCtx?.scenario ?? builtToolCtx?.scenario,
    capabilities: inboundToolCtx?.capabilities ?? builtToolCtx?.capabilities,
  };
}

function buildRoundContextBaseline(
  ctx: Context,
  toolCtx: ToolExecutionContext,
  params: AgentRoundContextParams,
): RoundContextBaseline {
  const sessionStore = ctx["yesimbot.session"] as AgentSessionStore | undefined;
  const sessionState = sessionStore?.getState(params.platform, params.channelId);
  const scenario =
    toolCtx.scenario ??
    buildScenarioFromView({
      view: createFallbackView(params),
      stimulusSource: buildStimulusSource(params.percept),
    });

  return {
    percept: params.percept,
    scenario,
    capabilities: buildCapabilitiesFromRuntime({
      session: params.session ?? toolCtx.session,
      bot: params.bot ?? toolCtx.bot,
      scenario,
      resolvers: params.resolvers,
    }),
    metadata: {
      channelKey: `${params.platform}:${params.channelId}`,
      traceId: params.percept.traceId,
    },
    skillState: sessionState ? projectSkillState(sessionState) : { active: [] },
  };
}

function toActiveSkill(skill: SkillDefinition): ActiveSkill {
  return {
    name: skill.name,
    effects: skill.allowedTools?.length ? ["tools"] : ["guidance"],
    metadata: {
      description: skill.description,
      allowedTools: skill.allowedTools ?? [],
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
