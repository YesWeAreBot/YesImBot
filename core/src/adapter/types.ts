import { randomUUID } from "node:crypto";

import type { UserContent } from "@yesimbot/agent/ai";
import type { Bot, Context, Session } from "koishi";

// ===== Event Source =====
export interface EventSource {
  platform: string;
  channelId: string;
  guildId?: string;
  threadId?: string;
  conversationType: "private" | "group" | "guild" | "thread";
}

// ===== Actor =====
export interface Actor {
  id: string;
  name?: string;
  avatar?: string;
  isSelf?: boolean;
}

// ===== Event Metadata =====
export interface EventMetadata {
  persist: boolean;
  triggerCandidate: boolean;
  bot: Bot;
  raw: Session;
}

// ===== Base Event =====
export interface AthenaEvent<K extends string = string, P = unknown> {
  id: string;
  kind: K;
  timestamp: number;
  source: EventSource;
  actor: Actor;
  target?: Actor;
  payload: P;
  metadata: EventMetadata;
}

// ===== Concrete Event Payloads =====
export interface ChatMessagePayload {
  messageId: string;
  content: string;
  quoteMessageId?: string;
  quoteSender?: Actor;
}

export interface MemberChangePayload {
  action: "join" | "leave" | "kick" | "ban" | "unban";
  groupId: string;
}

export interface MessageRecallPayload {
  messageId: string;
  originalSender?: Actor;
}

export interface ReactionPayload {
  messageId: string;
  emoji: string;
  action: "add" | "remove";
}

export interface PokePayload {
  targetId: string;
}

// ===== Concrete Event Types =====
export type ChatMessageEvent = AthenaEvent<"chat_message", ChatMessagePayload>;
export type MemberChangeEvent = AthenaEvent<"member_change", MemberChangePayload>;
export type MessageRecallEvent = AthenaEvent<"message_recall", MessageRecallPayload>;
export type ReactionEvent = AthenaEvent<"reaction", ReactionPayload>;
export type PokeEvent = AthenaEvent<"poke", PokePayload>;

// ===== Formatter Types =====
export interface FormatterContext {
  conversationType: EventSource["conversationType"];
  selfId: string;
}

export type EventFormatter<K extends string = string> = (
  event: AthenaEvent<K>,
  ctx: FormatterContext,
) => UserContent | null | Promise<UserContent | null>;

export interface FormatterRegistry {
  register(kind: string, formatter: EventFormatter): () => void;
  format(event: AthenaEvent, ctx: FormatterContext): Promise<UserContent | null>;
}

// ===== Platform Adapter Interface =====
export abstract class PlatformAdapter<C = unknown> {
  abstract platform: string;
  constructor(
    public ctx: Context,
    public config: C,
  ) {}
  abstract install(emit: (event: AthenaEvent) => void): void;
  formatters?: Record<string, EventFormatter>;
  capabilities?: Record<string, (...args: unknown[]) => Promise<unknown>>;
}

// ===== Factory Helper =====
export interface CreateEventInput<K extends string, P> {
  source: EventSource;
  actor: Actor;
  target?: Actor;
  payload: P;
  metadata: EventMetadata;
}

export function createEvent<K extends string, P>(
  kind: K,
  input: CreateEventInput<K, P>,
): AthenaEvent<K, P> {
  return {
    id: randomUUID(),
    kind,
    timestamp: Date.now(),
    ...input,
  };
}

// ===== Serialization =====
export interface SerializedEvent<K extends string = string, P = unknown> {
  version: 1;
  id: string;
  kind: K;
  timestamp: number;
  source: EventSource;
  actor: Actor;
  target?: Actor;
  payload: P;
}

export function serializeEvent<K extends string, P>(
  event: AthenaEvent<K, P>,
): SerializedEvent<K, P> {
  const { metadata: _, ...rest } = event;
  return { version: 1, ...rest };
}
