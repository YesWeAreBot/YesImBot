import type {
  AgentActionData,
  AgentResponseData,
  HeartbeatData,
  MessageEventData,
  SummaryData,
  TimelineEntry,
} from "../horizon/types";
import { TimelineEventType } from "../horizon/types";
import {
  DEFAULT_SCENARIO_TIMELINE_SEMANTICS,
  type ScenarioMarkedEvent,
  type ScenarioTimeline,
  type ScenarioTimelineEvent,
  type ScenarioTimelineHeartbeat,
  type ScenarioTimelineParticipant,
  type ScenarioTurn,
  type ScenarioTurnMessage,
  type ScenarioTurnSettlementStatus,
  type ScenarioTurnVisibleOutput,
} from "./contracts";

const TIMESTAMP_FALLBACK_BASE = Date.parse("2026-01-01T00:00:00.000Z");

interface NormalizedEntry {
  entry: TimelineEntry;
  timestamp: Date;
}

interface MutableTurn {
  id: string;
  startedAt: Date;
  settledAt: Date;
  settlement?: ScenarioTurnSettlementStatus;
  messages: ScenarioTurnMessage[];
  events: ScenarioTimelineEvent[];
  participantMap: Map<string, ScenarioTimelineParticipant>;
  visibleOutputs: ScenarioTurnVisibleOutput[];
  hasFailedToolResult: boolean;
  lastActivityAt: Date;
}

export function buildScenarioTimeline(entries: TimelineEntry[]): ScenarioTimeline {
  const normalizedEntries = entries
    .map((entry, index) => ({
      entry,
      timestamp: ensureDate(entry.timestamp, TIMESTAMP_FALLBACK_BASE + index * 1000),
    }))
    .sort((left, right) => compareEntries(left, right));

  const latestSummary = getLatestSummary(normalizedEntries);
  const markedEvents: ScenarioMarkedEvent[] = [];
  if (latestSummary) {
    markedEvents.push({
      id: latestSummary.id,
      type: "summary",
      timestamp: latestSummary.timestamp,
      detail: {
        coveredUntil: latestSummary.coveredUntil.toISOString(),
      },
    });
  }

  const cutoff = latestSummary?.coveredUntil;
  const activeEntries = normalizedEntries.filter(
    ({ entry, timestamp }) =>
      entry.type !== TimelineEventType.Summary &&
      (!cutoff || timestamp.getTime() > cutoff.getTime()),
  );

  const turns: ScenarioTurn[] = [];
  const heartbeatEvents: ScenarioTimelineHeartbeat[] = [];
  let currentTurn: MutableTurn | undefined;
  let turnIndex = 0;

  for (const { entry, timestamp } of activeEntries) {
    if (entry.type === TimelineEventType.Heartbeat) {
      const heartbeat = toHeartbeat(entry, timestamp);
      heartbeatEvents.push(heartbeat);
      markedEvents.push({
        id: heartbeat.id,
        type: "heartbeat",
        timestamp: heartbeat.timestamp,
        turnId: currentTurn?.id,
        detail: heartbeat.detail,
      });
      if (currentTurn) {
        currentTurn.events.push({
          id: heartbeat.id,
          type: "heartbeat",
          timestamp: heartbeat.timestamp,
          queryOnly: true,
          detail: heartbeat.detail,
        });
        currentTurn.lastActivityAt = timestamp;
      }
      continue;
    }

    if (!currentTurn) {
      turnIndex += 1;
      currentTurn = createTurn(turnIndex, timestamp);
    }

    switch (entry.type) {
      case TimelineEventType.Message: {
        const message = toTurnMessage(entry, timestamp);
        currentTurn.messages.push(message);
        currentTurn.events.push({
          id: message.id,
          type: "message",
          timestamp: message.timestamp,
          detail: { messageId: message.messageId },
        });
        currentTurn.participantMap.set(message.senderId, {
          id: message.senderId,
          name: message.senderName,
          type: "user",
        });
        currentTurn.lastActivityAt = timestamp;
        break;
      }
      case TimelineEventType.AgentResponse: {
        const data = entry.data as Partial<AgentResponseData>;
        const detail: Record<string, unknown> = {};
        if (typeof data.rawText === "string") {
          detail.rawText = data.rawText;
        }
        if (typeof data.error === "string") {
          detail.error = data.error;
        }
        currentTurn.events.push({
          id: entry.id,
          type: "agent.response",
          timestamp,
          detail,
        });
        currentTurn.lastActivityAt = timestamp;
        break;
      }
      case TimelineEventType.AgentAction: {
        const data = entry.data as Partial<AgentActionData>;
        const actions = readActions(data.actions);
        const toolResults = readToolResults(data.toolResults);

        currentTurn.events.push({
          id: entry.id,
          type: "agent.action",
          timestamp,
          detail: {
            actionNames: actions.map((action) => action.name),
            toolResultCount: toolResults.length,
          },
        });

        for (let resultIndex = 0; resultIndex < toolResults.length; resultIndex += 1) {
          const result = toolResults[resultIndex];
          const toolResultId = `${entry.id}:tool-result:${resultIndex + 1}`;
          const detail: Record<string, unknown> = {
            name: result.name,
            success: result.success,
          };
          if (typeof result.status === "string") {
            detail.status = result.status;
          }
          if (result.result !== undefined) {
            detail.result = result.result;
          }
          if (typeof result.error === "string") {
            detail.error = result.error;
          }

          currentTurn.events.push({
            id: toolResultId,
            type: "tool.result",
            timestamp,
            detail,
          });

          if (!result.success) {
            currentTurn.hasFailedToolResult = true;
          }

          markedEvents.push({
            id: toolResultId,
            type: result.success ? "tool-result" : "error",
            timestamp,
            turnId: currentTurn.id,
            detail,
          });

          if (isSuccessfulSendMessage(result)) {
            currentTurn.visibleOutputs.push({
              toolName: "send_message",
              success: true,
              messageId: readString(
                (result.result as Record<string, unknown> | undefined)?.messageId,
              ),
              content: readString((result.result as Record<string, unknown> | undefined)?.content),
              timestamp,
            });
          }
        }

        currentTurn.settlement = resolveSettlement(currentTurn);
        currentTurn.settledAt = timestamp;
        currentTurn.lastActivityAt = timestamp;
        turns.push(finalizeTurn(currentTurn));
        currentTurn = undefined;
        break;
      }
      case TimelineEventType.Summary:
        break;
    }
  }

  if (currentTurn) {
    currentTurn.settlement = resolveSettlement(currentTurn);
    currentTurn.settledAt = currentTurn.lastActivityAt;
    turns.push(finalizeTurn(currentTurn));
  }

  return {
    turns,
    latestSummary,
    activeSegment: {
      mode: "after-latest-summary",
      summaryId: latestSummary?.id,
      startedAt: activeEntries[0]?.timestamp,
    },
    markedEvents,
    heartbeatEvents,
    semantics: DEFAULT_SCENARIO_TIMELINE_SEMANTICS,
  };
}

export function getRecentTurns(timeline: ScenarioTimeline, limit: number = 5): ScenarioTurn[] {
  if (limit <= 0) {
    return [];
  }

  const activeTurns = getActiveSegmentTurns(timeline);
  return activeTurns.slice(Math.max(activeTurns.length - limit, 0));
}

export function getMessageCount(timeline: ScenarioTimeline): number {
  return getActiveSegmentTurns(timeline).reduce((count, turn) => count + turn.messages.length, 0);
}

export function getParticipants(timeline: ScenarioTimeline): ScenarioTimelineParticipant[] {
  const participantMap = new Map<string, ScenarioTimelineParticipant>();
  for (const turn of getActiveSegmentTurns(timeline)) {
    for (const participant of turn.participants) {
      participantMap.set(participant.id, participant);
    }
  }
  return Array.from(participantMap.values());
}

export function getMarkedEvents(timeline: ScenarioTimeline): ScenarioMarkedEvent[] {
  const activeTurnIds = new Set(getActiveSegmentTurns(timeline).map((turn) => turn.id));
  const summaryCutoff = timeline.latestSummary?.coveredUntil;

  return timeline.markedEvents.filter((event) => {
    if (event.type === "summary") {
      return false;
    }

    if (event.turnId) {
      return activeTurnIds.has(event.turnId);
    }

    if (!summaryCutoff) {
      return true;
    }

    return event.timestamp.getTime() > summaryCutoff.getTime();
  });
}

function getActiveSegmentTurns(timeline: ScenarioTimeline): ScenarioTurn[] {
  const summaryCutoff = timeline.latestSummary?.coveredUntil;
  if (!summaryCutoff) {
    return timeline.turns;
  }

  return timeline.turns.filter((turn) => turn.settledAt.getTime() > summaryCutoff.getTime());
}

function getLatestSummary(entries: NormalizedEntry[]): ScenarioTimeline["latestSummary"] {
  const summaryEntry = [...entries]
    .reverse()
    .find(({ entry }) => entry.type === TimelineEventType.Summary);

  if (!summaryEntry || summaryEntry.entry.type !== TimelineEventType.Summary) {
    return undefined;
  }

  const data = summaryEntry.entry.data as Partial<SummaryData>;
  const coveredUntil = ensureDate(data.coveredUntil, summaryEntry.timestamp.getTime());

  return {
    id: summaryEntry.entry.id,
    timestamp: summaryEntry.timestamp,
    coveredUntil,
    content: readString(data.content) ?? "",
  };
}

function createTurn(turnIndex: number, timestamp: Date): MutableTurn {
  return {
    id: `turn-${String(turnIndex).padStart(8, "0")}`,
    startedAt: timestamp,
    settledAt: timestamp,
    messages: [],
    events: [],
    participantMap: new Map<string, ScenarioTimelineParticipant>(),
    visibleOutputs: [],
    hasFailedToolResult: false,
    lastActivityAt: timestamp,
  };
}

function finalizeTurn(turn: MutableTurn): ScenarioTurn {
  return {
    id: turn.id,
    startedAt: turn.startedAt,
    settledAt: turn.settledAt,
    settlement: turn.settlement ?? "silent",
    messages: turn.messages,
    events: turn.events,
    participants: Array.from(turn.participantMap.values()),
    visibleOutputs: turn.visibleOutputs,
  };
}

function toTurnMessage(entry: TimelineEntry, timestamp: Date): ScenarioTurnMessage {
  const data = entry.data as Partial<MessageEventData>;
  const senderId = readString(data.senderId) ?? "unknown-sender";
  const senderName = readString(data.senderName) ?? senderId;
  return {
    id: entry.id,
    messageId: readString(data.messageId) ?? entry.id,
    senderId,
    senderName,
    content: readString(data.content) ?? "",
    timestamp,
  };
}

function toHeartbeat(entry: TimelineEntry, timestamp: Date): ScenarioTimelineHeartbeat {
  const data = entry.data as Partial<HeartbeatData>;
  const detail: Record<string, unknown> = {};
  if (typeof data.channelSummary === "string") {
    detail.channelSummary = data.channelSummary;
  }
  return {
    id: entry.id,
    timestamp,
    triggeredBy: data.triggeredBy === "global" ? "global" : "manual",
    queryOnly: true,
    detail,
  };
}

function readActions(value: unknown): AgentActionData["actions"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const actions: AgentActionData["actions"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const action = item as Record<string, unknown>;
    const name = readString(action.name);
    if (!name) {
      continue;
    }
    const params =
      action.params && typeof action.params === "object"
        ? (action.params as Record<string, unknown>)
        : undefined;
    actions.push({ name, params });
  }
  return actions;
}

function readToolResults(value: unknown): AgentActionData["toolResults"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const results: AgentActionData["toolResults"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const result = item as Record<string, unknown>;
    const name = readString(result.name);
    const success = result.success === true;
    if (!name) {
      continue;
    }

    const status = readString(result.status);
    const error = readString(result.error);
    results.push({
      name,
      success,
      status,
      result: result.result,
      error,
    });
  }
  return results;
}

function resolveSettlement(turn: MutableTurn): ScenarioTurnSettlementStatus {
  if (turn.visibleOutputs.length > 0) {
    return "success";
  }
  if (turn.hasFailedToolResult) {
    return "failed";
  }
  if (turn.messages.length > 0 || turn.events.length > 0) {
    return "silent";
  }
  return "skipped";
}

function isSuccessfulSendMessage(result: AgentActionData["toolResults"][number]): boolean {
  return result.success && result.name === "send_message";
}

function compareEntries(left: NormalizedEntry, right: NormalizedEntry): number {
  const byTimestamp = left.timestamp.getTime() - right.timestamp.getTime();
  if (byTimestamp !== 0) {
    return byTimestamp;
  }
  return left.entry.id.localeCompare(right.entry.id);
}

function ensureDate(value: unknown, fallbackEpoch: number): Date {
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
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}
