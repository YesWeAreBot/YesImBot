import type { Bot, Session } from "koishi";

import type { HorizonScenarioAdapterSource, MessageRecord, TimelineEntry } from "../horizon/types";
import { TimelineEventType } from "../horizon/types";
import {
  CAPABILITY_KEYS,
  type Capabilities,
  type CapabilityState,
  type Percept,
  type RoundContext,
  type Scenario,
  type SkillState,
} from "./contracts";
import { buildScenarioTimeline, getMessageCount, getParticipants } from "./scenario-timeline";

export interface RuntimeBoundContext {
  scenario: Scenario;
  capabilities: Capabilities;
  roundContext: RoundContext;
}

export function buildScenarioFromView(source: HorizonScenarioAdapterSource): Scenario {
  const timelineEntries = normalizeTimelineEntries(source);
  const scenarioTimeline = buildScenarioTimeline(timelineEntries);
  const participants = getParticipants(scenarioTimeline).map((participant) => ({
    id: participant.id,
    name: participant.name,
    type: participant.type,
  }));

  return {
    raw: {
      self: source.view.self,
      environment: source.view.environment,
      entities: source.view.entities,
      timeline: scenarioTimeline,
      scenarioTimeline,
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
        eventCount: timelineEntries.length,
        turnCount: scenarioTimeline.turns.length,
        messageCount: getMessageCount(scenarioTimeline),
        participantCount: participants.length,
      },
    },
  };
}

export function buildCapabilitiesFromRuntime(params: {
  session?: Pick<Session, "isDirect" | "quote" | "guildId">;
  bot?: Pick<Bot, "selfId">;
  scenario?: Scenario;
  resolvers?: Array<
    (params: {
      session?: Pick<Session, "isDirect" | "quote" | "guildId">;
      scenario?: Scenario;
      bot?: Pick<Bot, "selfId">;
    }) => Record<string, CapabilityState>
  >;
}): Capabilities {
  const hasSession = Boolean(params.session);
  const sendMessage: CapabilityState = params.bot?.selfId
    ? { status: "available" as const }
    : {
        status: "unavailable" as const,
        reason: "bot-unavailable",
        recoverable: true,
      };

  const replyByQuote: CapabilityState = !hasSession
    ? {
        status: "unavailable" as const,
        reason: "session-unavailable",
        recoverable: true,
      }
    : params.session?.quote
      ? { status: "available" as const }
      : {
          status: "unavailable" as const,
          reason: "quote-message-unavailable",
        };

  const directMessage: CapabilityState = !hasSession
    ? {
        status: "unavailable" as const,
        reason: "session-unavailable",
        recoverable: true,
      }
    : params.session?.isDirect
      ? { status: "available" as const }
      : {
          status: "unavailable" as const,
          reason: "not-direct-channel",
        };

  const platformSession: CapabilityState = hasSession
    ? { status: "available" }
    : {
        status: "unavailable",
        reason: "session-unavailable",
        recoverable: true,
      };

  const messageDelete: CapabilityState = {
    status: "unavailable",
    reason: "not-supported",
  };

  const core: Record<string, CapabilityState> = {
    [CAPABILITY_KEYS.MESSAGE_SEND]: withCoreSource(sendMessage),
    [CAPABILITY_KEYS.MESSAGE_REPLY]: withCoreSource(replyByQuote),
    [CAPABILITY_KEYS.MESSAGE_READ_HISTORY]: withCoreSource({
      status: "available",
      detail: "horizon-history-access",
    }),
  };

  const extended: Record<string, CapabilityState> = {
    [CAPABILITY_KEYS.MESSAGE_DIRECT]: withCoreSource(directMessage),
    [CAPABILITY_KEYS.MESSAGE_DELETE]: withCoreSource(messageDelete),
    [CAPABILITY_KEYS.PLATFORM_SESSION]: withCoreSource(platformSession),
  };

  for (const resolver of params.resolvers ?? []) {
    const result = resolver({
      session: params.session,
      scenario: params.scenario,
      bot: params.bot,
    });
    for (const [key, state] of Object.entries(result ?? {})) {
      if (!state || typeof state !== "object" || !("status" in state)) {
        continue;
      }

      const existing = extended[key] ?? core[key];
      if (!existing) {
        extended[key] = state;
        continue;
      }

      if (state.status === "unavailable") {
        extended[key] = state;
        continue;
      }

      if (existing.status === "unavailable") {
        if (extended[key] === undefined) {
          extended[key] = existing;
        }
        continue;
      }

      extended[key] = state;
    }
  }

  return {
    core,
    extended,
  };
}

function withCoreSource(state: CapabilityState): CapabilityState {
  return { ...state, source: "core" };
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

function normalizeTimelineEntries(source: HorizonScenarioAdapterSource): TimelineEntry[] {
  const entityById = new Map(source.view.entities.map((entity) => [entity.id, entity]));
  const fallbackBase = Date.now();

  return source.view.history.map((entry, index) => {
    const timestamp = normalizeDate(entry.timestamp, fallbackBase + index * 1000);
    if (entry.type !== TimelineEventType.Message) {
      return {
        ...entry,
        timestamp,
      };
    }

    const senderId =
      readString(entry.data?.senderId) ?? source.stimulusSource.senderId ?? "unknown-sender";
    const senderEntity = entityById.get(senderId);
    const senderName = readString(entry.data?.senderName) ?? senderEntity?.name ?? senderId;

    const messageRecord: MessageRecord = {
      ...entry,
      timestamp,
      data: {
        ...entry.data,
        messageId: readString(entry.data?.messageId) ?? entry.id,
        senderId,
        senderName,
        content: readString(entry.data?.content) ?? "",
      },
    };

    return messageRecord;
  });
}

function normalizeDate(value: unknown, fallbackEpoch: number): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(fallbackEpoch);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
