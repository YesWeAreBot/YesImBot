export const RUNTIME_CONTRACT_VERSION = "54.1";

export type TriggerType =
  | "mention"
  | "reply"
  | "keyword"
  | "random"
  | "direct"
  | "timer"
  | "internal";

export type ChannelKey = { platform: string; channelId: string };

export type ScenarioTurnSettlementStatus = "success" | "silent" | "skipped" | "failed";

export type ScenarioTimelineEventType =
  | "message"
  | "agent.response"
  | "agent.action"
  | "tool.result"
  | "heartbeat";

export interface ScenarioTimelineParticipant {
  id: string;
  name: string;
  type: string;
}

export interface ScenarioTurnMessage {
  id: string;
  messageId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: Date;
}

export interface ScenarioTurnVisibleOutput {
  toolName: "send_message";
  success: true;
  messageId?: string;
  content?: string;
  timestamp: Date;
}

export interface ScenarioTimelineEvent {
  id: string;
  type: ScenarioTimelineEventType;
  timestamp: Date;
  queryOnly?: boolean;
  detail?: Record<string, unknown>;
}

export interface ScenarioTimelineHeartbeat {
  id: string;
  timestamp: Date;
  triggeredBy: "global" | "manual";
  queryOnly: true;
  detail?: Record<string, unknown>;
}

export interface ScenarioTurn {
  id: string;
  startedAt: Date;
  settledAt: Date;
  settlement: ScenarioTurnSettlementStatus;
  messages: ScenarioTurnMessage[];
  events: ScenarioTimelineEvent[];
  participants: ScenarioTimelineParticipant[];
  visibleOutputs: ScenarioTurnVisibleOutput[];
}

export interface ScenarioTimelineSummary {
  id: string;
  timestamp: Date;
  coveredUntil: Date;
  content: string;
}

export interface ScenarioTimelineSemantics {
  summaryPosition: "background";
  heartbeatRendering: "query-only";
  agentResponseVisibility: "internal-draft";
  visibleOutputSource: "send_message-success";
  defaultQueryWindow: "active-segment";
}

export interface ScenarioTimelineActiveSegment {
  mode: "after-latest-summary";
  summaryId?: string;
  startedAt?: Date;
}

export type ScenarioMarkedEventType =
  | "summary"
  | "error"
  | "tool-result"
  | "reference"
  | "heartbeat";

export interface ScenarioMarkedEvent {
  id: string;
  type: ScenarioMarkedEventType;
  timestamp: Date;
  turnId?: string;
  detail?: Record<string, unknown>;
}

export interface ScenarioTimeline {
  turns: ScenarioTurn[];
  latestSummary?: ScenarioTimelineSummary;
  activeSegment: ScenarioTimelineActiveSegment;
  markedEvents: ScenarioMarkedEvent[];
  heartbeatEvents: ScenarioTimelineHeartbeat[];
  semantics: ScenarioTimelineSemantics;
}

export const DEFAULT_SCENARIO_TIMELINE_SEMANTICS: ScenarioTimelineSemantics = {
  summaryPosition: "background",
  heartbeatRendering: "query-only",
  agentResponseVisibility: "internal-draft",
  visibleOutputSource: "send_message-success",
  defaultQueryWindow: "active-segment",
};

export interface Percept {
  id: string;
  traceId: string;
  type: TriggerType;
  platform: string;
  channelId: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface Scenario {
  raw: {
    self: { id: string; name: string; role?: string };
    environment: {
      type: string;
      id: string;
      name: string;
      platform: string;
      channelId: string;
      description?: string;
    };
    entities: Array<{
      id: string;
      type: string;
      name: string;
      userId?: string;
      username?: string;
      nickname?: string;
      attributes?: Record<string, unknown>;
    }>;
    timeline: Array<Record<string, unknown>>;
    scenarioTimeline?: ScenarioTimeline;
    stimulusSource: {
      type: "message" | "event" | "system" | "timer" | "internal";
      messageId?: string;
      senderId?: string;
      triggerId?: string;
      ref?: Record<string, unknown>;
    };
  };
  derived: {
    focus: Record<string, unknown>;
    participants: Array<Record<string, unknown>>;
    attention: Record<string, unknown>;
    recentMetrics: Record<string, unknown>;
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

    return event.timestamp > summaryCutoff;
  });
}

function getActiveSegmentTurns(timeline: ScenarioTimeline): ScenarioTurn[] {
  const summaryCutoff = timeline.latestSummary?.coveredUntil;
  if (!summaryCutoff) {
    return timeline.turns;
  }

  return timeline.turns.filter((turn) => turn.settledAt > summaryCutoff);
}

export type CapabilityState =
  | {
      status: "available";
      detail?: string;
      limits?: Record<string, unknown>;
    }
  | {
      status: "unavailable";
      reason: string;
      recoverable?: boolean;
      detail?: string;
    };

export interface Capabilities {
  core: {
    sendMessage: CapabilityState;
    readHistory: CapabilityState;
    [key: string]: CapabilityState;
  };
  extended: Record<string, CapabilityState>;
}

export interface RoundSnapshot {
  version: number;
  createdAt: Date;
  scenario: Scenario;
  capabilities: Capabilities;
  metadata: Record<string, unknown>;
}

export interface SkillState {
  active: string[];
  metadata?: Record<string, unknown>;
}

export interface RoundContext {
  percept: Percept;
  scenario: Scenario;
  capabilities: Capabilities;
  metadata: Record<string, unknown>;
  skillState: SkillState;
  snapshot: RoundSnapshot;
}

export type AgentFinalOutcomeStatus = "success" | "silent" | "skipped" | "failed" | "degraded";

export interface AgentOutcomeCountSummary {
  total: number;
  succeeded: number;
  failed: number;
  names: string[];
}

export interface AgentFinalOutcome {
  status: AgentFinalOutcomeStatus;
  producedVisibleOutput: boolean;
  actions: AgentOutcomeCountSummary;
  toolCalls: AgentOutcomeCountSummary;
}

export type AgentIncidentPhase = "start" | "think-act" | "tool" | "end";

export interface AgentIncident {
  phase: AgentIncidentPhase;
  category: string;
  summary: string;
  recovered: boolean;
  detail?: string;
}

export interface AgentEndSummary {
  finalOutcome: AgentFinalOutcome;
  incidents: AgentIncident[];
}
