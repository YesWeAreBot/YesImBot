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

// ===== Event Meta =====
export interface EventMeta {
  persist: boolean;
  triggerCandidate: boolean;
  bot: Bot;
  raw: Session;
}

// ===== Base Event =====
export interface AthenaEvent<K extends string = string, D = unknown> {
  id: string;
  kind: K;
  timestamp: number;
  source: EventSource;
  actor: Actor;
  target?: Actor;
  details: D;
  meta: EventMeta;
}

// ===== Concrete Event Details =====
export interface ChatMessageDetails {
  messageId: string;
  content: string;
  quoteMessageId?: string;
  quoteSender?: Actor;
}

export interface MemberChangeDetails {
  action: "join" | "leave" | "kick" | "ban" | "unban";
  groupId: string;
}

export interface MessageRecallDetails {
  messageId: string;
  originalSender?: Actor;
}

export interface ReactionDetails {
  messageId: string;
  emoji: string;
  action: "add" | "remove";
}

export interface PokeDetails {
  targetId: string;
}

// ===== Concrete Event Types =====
export type ChatMessageEvent = AthenaEvent<"chat_message", ChatMessageDetails>;
export type MemberChangeEvent = AthenaEvent<"member_change", MemberChangeDetails>;
export type MessageRecallEvent = AthenaEvent<"message_recall", MessageRecallDetails>;
export type ReactionEvent = AthenaEvent<"reaction", ReactionDetails>;
export type PokeEvent = AthenaEvent<"poke", PokeDetails>;

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
export interface CreateEventInput<K extends string, D> {
  source: EventSource;
  actor: Actor;
  target?: Actor;
  details: D;
  meta: EventMeta;
}

export function createEvent<K extends string, D>(
  kind: K,
  input: CreateEventInput<K, D>,
): AthenaEvent<K, D> {
  return {
    id: randomUUID(),
    kind,
    timestamp: Date.now(),
    ...input,
  };
}
