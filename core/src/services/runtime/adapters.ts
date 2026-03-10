import type { Bot, Session } from "koishi";

import type { HorizonScenarioAdapterSource } from "../horizon/types";
import type { Capabilities, Percept, RoundContext, Scenario, SkillState } from "./contracts";

export interface RuntimeBoundContext {
  scenario: Scenario;
  capabilities: Capabilities;
  roundContext: RoundContext;
}

export function buildScenarioFromView(source: HorizonScenarioAdapterSource): Scenario {
  const timeline = source.view.history.map((entry) => ({
    id: entry.id,
    type: entry.type,
    timestamp: entry.timestamp,
    data: entry.data,
  })) as Scenario["raw"]["timeline"];

  const participants = source.view.entities.map((entity) => ({
    id: entity.id,
    type: entity.type,
    name: entity.name,
  }));

  return {
    raw: {
      self: source.view.self,
      environment: source.view.environment,
      entities: source.view.entities,
      timeline,
      stimulusSource: {
        type: source.stimulusSource.type,
        messageId: source.stimulusSource.messageId,
        senderId: source.stimulusSource.senderId,
        triggerId: source.stimulusSource.triggerId,
        ref: source.stimulusSource.ref,
      },
    },
    derived: {
      focus: {
        triggerType: source.stimulusSource.type,
      },
      participants,
      attention: {},
      recentMetrics: {
        eventCount: timeline.length,
        messageCount: timeline.filter((entry) => entry.type === "message").length,
      },
    },
  };
}

export function buildCapabilitiesFromRuntime(params: {
  session?: Pick<Session, "isDirect" | "quote">;
  bot?: Pick<Bot, "selfId">;
}): Capabilities {
  const sendMessage = params.bot?.selfId
    ? { status: "available" as const }
    : {
        status: "unavailable" as const,
        reason: "bot-unavailable",
        recoverable: true,
      };

  const replyByQuote = params.session?.quote
    ? { status: "available" as const }
    : {
        status: "unavailable" as const,
        reason: "quote-message-unavailable",
      };

  const directMessage = params.session?.isDirect
    ? { status: "available" as const }
    : {
        status: "unavailable" as const,
        reason: "not-direct-channel",
      };

  return {
    core: {
      sendMessage,
      readHistory: { status: "available", detail: "horizon-history-access" },
    },
    extended: {
      replyByQuote,
      directMessage,
    },
  };
}

export function createRoundContext(params: {
  percept: Percept;
  scenario: Scenario;
  capabilities: Capabilities;
  metadata?: Record<string, unknown>;
  skillState?: SkillState;
}): RoundContext {
  const scenario = freezeClone(params.scenario);
  const capabilities = freezeClone(params.capabilities);
  const metadata = freezeClone(params.metadata ?? {});
  const skillState = freezeClone(params.skillState ?? { active: [] });
  const createdAt = new Date();

  return {
    percept: params.percept,
    scenario,
    capabilities,
    metadata,
    skillState,
    snapshot: {
      version: 1,
      createdAt,
      scenario,
      capabilities,
      metadata,
    },
  };
}

export function commitRoundContext(
  current: RoundContext,
  updates: Partial<Pick<RoundContext, "scenario" | "capabilities" | "metadata" | "skillState">>,
): RoundContext {
  const scenario = freezeClone(updates.scenario ?? current.scenario);
  const capabilities = freezeClone(updates.capabilities ?? current.capabilities);
  const metadata = freezeClone(updates.metadata ?? current.metadata);
  const skillState = freezeClone(updates.skillState ?? current.skillState);

  return {
    percept: current.percept,
    scenario,
    capabilities,
    metadata,
    skillState,
    snapshot: {
      version: current.snapshot.version + 1,
      createdAt: new Date(),
      scenario,
      capabilities,
      metadata,
    },
  };
}

export function bindCommittedRoundContext<T extends object>(
  baseContext: T,
  roundContext: RoundContext,
): T & RuntimeBoundContext {
  return {
    ...baseContext,
    scenario: roundContext.snapshot.scenario,
    capabilities: roundContext.snapshot.capabilities,
    roundContext,
  } as T & RuntimeBoundContext;
}

function freezeClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return Object.freeze(value);
  }

  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    return Object.freeze(value);
  }

  return value;
}
