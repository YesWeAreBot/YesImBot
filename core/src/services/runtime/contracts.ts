import type { LoadAttempt } from "../skill/types";

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
    timeline: ScenarioTimeline;
    scenarioTimeline: ScenarioTimeline;
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

export type CapabilityState =
  | {
      status: "available";
      detail?: string;
      limits?: Record<string, unknown>;
      source?: string;
    }
  | {
      status: "unavailable";
      reason: string;
      recoverable?: boolean;
      detail?: string;
      source?: string;
    };

export interface Capabilities {
  core: Record<string, CapabilityState>;
  extended: Record<string, CapabilityState>;
}

export const CAPABILITY_KEYS = {
  MESSAGE_SEND: "message.send",
  MESSAGE_REPLY: "message.reply",
  MESSAGE_DELETE: "message.delete",
  MESSAGE_READ_HISTORY: "message.read_history",
  MESSAGE_DIRECT: "message.direct",
  MEMBER_MODERATE: "member.moderate",
  SOCIAL_ESSENCE: "social.essence",
  SOCIAL_REACTION: "social.reaction",
  PLATFORM_SESSION: "platform.session",
} as const;

export function getCapabilityByKey(
  capabilities: Capabilities | undefined,
  key: string,
): CapabilityState | undefined {
  if (!capabilities) {
    return undefined;
  }
  return capabilities.core[key] ?? capabilities.extended[key];
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
  loadHistory?: LoadAttempt[];
  persistentRoster?: string[];
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
