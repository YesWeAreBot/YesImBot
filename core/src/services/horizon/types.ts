import type { Session } from "koishi";

import { TriggerType, Scope, BasePerceptRef } from "../shared/types";

export type AllowedChannel = { platform: string; type: "private" | "guild"; id: string };

// ---- Horizon Event ----

export interface HorizonMessageEvent {
  scope: Scope;
  timestamp: Date;
  payload: { messageId: string; senderId: string; senderName: string; content: string };
  triggerType: TriggerType;
  runtime?: { session: Session };
}

declare module "koishi" {
  interface Events {
    "horizon/message": (event: HorizonMessageEvent) => void;
  }
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
  stage?: string;
}

export interface AgentSummaryObservation {
  type: "agent.summary";
  timestamp: Date;
  summary: string;
}

export type Observation = MessageObservation | AgentSummaryObservation;

// ---- HorizonView ----

export interface HorizonView {
  percept: BasePerceptRef;
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
