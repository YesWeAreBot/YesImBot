import type { Bot, Session } from "koishi";

import type { HorizonScenarioAdapterSource } from "../horizon/types";
import type { Capabilities, Percept, RoundContext, Scenario, SkillState } from "./contracts";

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
  const scenario = structuredClone(params.scenario);
  const capabilities = structuredClone(params.capabilities);
  const metadata = structuredClone(params.metadata ?? {});
  const skillState = structuredClone(params.skillState ?? { active: [] });
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
      scenario: structuredClone(scenario),
      capabilities: structuredClone(capabilities),
      metadata: structuredClone(metadata),
    },
  };
}

export function commitRoundContext(
  current: RoundContext,
  updates: Partial<Pick<RoundContext, "scenario" | "capabilities" | "metadata" | "skillState">>,
): RoundContext {
  const scenario = structuredClone(updates.scenario ?? current.scenario);
  const capabilities = structuredClone(updates.capabilities ?? current.capabilities);
  const metadata = structuredClone(updates.metadata ?? current.metadata);
  const skillState = structuredClone(updates.skillState ?? current.skillState);

  return {
    percept: current.percept,
    scenario,
    capabilities,
    metadata,
    skillState,
    snapshot: {
      version: current.snapshot.version + 1,
      createdAt: new Date(),
      scenario: structuredClone(scenario),
      capabilities: structuredClone(capabilities),
      metadata: structuredClone(metadata),
    },
  };
}
