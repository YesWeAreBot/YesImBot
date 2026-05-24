import type { UserContent } from "@yesimbot/agent/ai";
import type { Context } from "koishi";

import {
  createAthenaEvent as createEvent,
  serializeAthenaEvent as serializeEvent,
} from "../bot/events.js";
import type { Actor, AthenaEvent, AthenaEventMap, EventSource } from "../bot/types.js";

export type {
  Actor,
  AthenaEvent,
  AthenaEventKind,
  AthenaEventMap,
  ChatMessagePayload,
  CreateAthenaEventInput,
  EventMetadata,
  EventSource,
  MemberChangePayload,
  MessageRecallPayload,
  PokePayload,
  ReactionPayload,
} from "../bot/types.js";

export interface FormatterContext {
  conversationType: EventSource["conversationType"];
  selfId: string;
}

export type EventFormatter<K extends string = string> = (
  event: AthenaEvent<K & keyof AthenaEventMap>,
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
}

export type ChatMessageEvent = AthenaEvent<"chat_message">;
export type MemberChangeEvent = AthenaEvent<"member_change">;
export type MessageRecallEvent = AthenaEvent<"message_recall">;
export type ReactionEvent = AthenaEvent<"reaction">;
export type PokeEvent = AthenaEvent<"poke">;
export type SerializedEvent<
  K extends string = keyof AthenaEventMap,
  P = K extends keyof AthenaEventMap ? AthenaEventMap[K] : unknown,
> = K extends keyof AthenaEventMap
  ? Omit<import("../bot/types.js").SerializedAthenaEvent<K>, "payload"> & { payload: P }
  : {
      version: 1;
      id: string;
      kind: K;
      timestamp: number;
      source: EventSource;
      actor: Actor;
      target?: Actor;
      payload: P;
    };

export { createEvent, serializeEvent };
