import type { UserContent } from "ai";
import type { Session } from "koishi";

import { TriggerType, type ChannelKey } from "../shared/types";

export type AllowedChannel = { platform: string; type: "private" | "guild"; id: string };

export type Role = "owner" | "admin" | "member";

// ---- Horizon Event ----

export interface HorizonMessageEvent {
  platform: string;
  channelId: string;
  timestamp: Date;
  payload: {
    messageId: string;
    senderId: string;
    senderName?: string;
    content: string;
    quoteId?: string;
  };
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
  AgentResponse = "agent.response",
  AgentAction = "agent.action",
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
  platform: string;
  channelId: string;
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

export interface AgentResponseData {
  rawText: string;
  error?: string;
}

export type AgentResponseRecord = BaseTimelineEntry<
  TimelineEventType.AgentResponse,
  AgentResponseData
>;

export interface AgentActionData {
  actions: Array<{ name: string; params?: Record<string, unknown> }>;
  toolResults: Array<{ name: string; status: string; result?: unknown; error?: string }>;
}

export type AgentActionRecord = BaseTimelineEntry<TimelineEventType.AgentAction, AgentActionData>;

export type TimelineEntry = MessageRecord | AgentResponseRecord | AgentActionRecord;

// ---- Entity ----

export interface EntityRecord {
  id: string;
  type: "user" | "member";
  name: string;
  userId: string;
  username: string;
  nickname?: string;
  parentId?: string;
  refId?: string;
  attributes: Record<string, unknown>;
  updatedAt: Date;
}

export interface Entity {
  id: string;
  type: string;
  name: string;
  userId?: string;
  username?: string;
  nickname?: string;
  attributes?: Record<string, unknown>;
}

export interface Environment {
  type: string;
  id: string;
  name: string;
  platform: string;
  channelId: string;
  description?: string;
}

export interface SelfInfo {
  id: string;
  name: string;
  role?: Role;
}

// ---- Image Config ----

export interface ImageConfig {
  imageMode: "native" | "off";
  maxImagesInContext: number;
  imageLifecycleCount: number;
}

// ---- Observation (TEMPORARY - will be removed in Plan 02) ----

export interface MessageObservation {
  type: "message";
  timestamp: Date;
  sender: Entity;
  messageId: string;
  content: string | UserContent;
  stage?: string;
  replyTo?: string;
}

export interface AgentResponseObservation {
  type: "agent.response";
  timestamp: Date;
  data: AgentResponseData;
}

export interface AgentActionObservation {
  type: "agent.action";
  timestamp: Date;
  data: AgentActionData;
}

export type Observation = MessageObservation | AgentResponseObservation | AgentActionObservation;

// ---- ViewOptions ----

export interface ViewOptions {
  session?: Session;
  selfId?: string;
  selfName?: string;
}

// ---- HorizonView ----

export interface HorizonView {
  self: SelfInfo;
  environment?: Environment;
  entities?: Entity[];
  history?: TimelineEntry[];
}

// ---- Query ----

export interface EventQueryOptions {
  key?: ChannelKey;
  types?: TimelineEventType[];
  limit?: number;
  since?: Date;
  until?: Date;
  orderBy?: "asc" | "desc";
}
