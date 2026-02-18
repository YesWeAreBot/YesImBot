import type { Session } from "koishi";

// ---- Scope ----

export interface Scope {
  platform?: string;
  channelId?: string;
  guildId?: string;
  isDirect?: boolean;
}

// ---- Timeline ----

export enum TimelineEventType {
  Message = "message",
  AgentSummary = "agent.summary",
}

export enum TimelinePriority {
  Noise = 0,
  Normal = 1,
  Important = 2,
  Core = 3,
}

export enum TimelineStage {
  New = "new",
  Active = "active",
  Archived = "archived",
  Deleted = "deleted",
}

export interface BaseTimelineEntry<Type extends TimelineEventType, Data extends object> {
  id: string;
  timestamp: Date;
  scope: Scope;
  type: Type;
  priority: TimelinePriority;
  stage: TimelineStage;
  data: Data;
}

export interface MessageEventData {
  messageId: string;
  senderId: string;
  senderName: string;
  content: string;
  replyTo?: string;
}

export type MessageRecord = BaseTimelineEntry<TimelineEventType.Message, MessageEventData>;

export interface AgentSummaryData {
  summary: string;
}

export type AgentSummaryRecord = BaseTimelineEntry<
  TimelineEventType.AgentSummary,
  AgentSummaryData
>;

export type TimelineEntry = MessageRecord | AgentSummaryRecord;

// ---- Entity ----

export interface EntityRecord {
  id: string;
  type: string;
  name: string;
  parentId?: string;
  refId?: string;
  attributes: Record<string, unknown>;
  updatedAt: Date;
}

export interface Entity {
  id: string;
  type: string;
  name: string;
  attributes?: Record<string, unknown>;
}

export interface Environment {
  type: string;
  id: string;
  name: string;
  description?: string;
  metadata: Record<string, unknown>;
}

export interface SelfInfo {
  id: string;
  name: string;
}

// ---- Observation ----

export interface MessageObservation {
  type: "message";
  timestamp: Date;
  sender: Entity;
  messageId: string;
  content: string;
}

export interface AgentSummaryObservation {
  type: "agent.summary";
  timestamp: Date;
  summary: string;
}

export type Observation = MessageObservation | AgentSummaryObservation;

// ---- Percept ----

export type TriggerType = "mention" | "reply" | "keyword" | "random" | "direct";

export enum PerceptType {
  UserMessage = "user.message",
}

export interface BasePercept<T extends PerceptType> {
  id: string;
  type: T;
  scope: Scope;
  priority: number;
  timestamp: Date;
}

export interface UserMessagePercept extends BasePercept<PerceptType.UserMessage> {
  payload: {
    messageId: string;
    content: string;
    sender: { id: string; name: string; role?: string };
    channel: { id: string; platform: string; guildId?: string };
  };
  triggerType: TriggerType;
  runtime?: { session: Session };
}

export type Percept = UserMessagePercept;

// ---- HorizonView ----

export interface HorizonView {
  percept: Percept;
  self: SelfInfo;
  environment?: Environment;
  entities?: Entity[];
  history?: Observation[];
}

// ---- Query ----

export interface EventQueryOptions {
  scope?: Scope;
  types?: TimelineEventType[];
  limit?: number;
  since?: Date;
  until?: Date;
  orderBy?: "asc" | "desc";
}
