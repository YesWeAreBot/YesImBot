import type { UserContent } from "@yesimbot/agent/ai";

export interface EventSource {
  platform: string;
  channelId: string;
  guildId?: string;
  threadId?: string;
  sourceType: "private" | "group" | "guild" | "thread";
  selfId?: string;
}

export interface Actor {
  id: string;
  name?: string;
  avatar?: string;
  isSelf?: boolean;
}

export interface EventMetadata {
  persist: boolean;
  triggerCandidate: boolean;
}

export interface MessagePayload {
  messageId: string;
  content: string;
  quoteMessageId?: string;
  quoteSender?: Actor;
}

export interface PlatformEventPayloadMap {
  message: MessagePayload;
}

export type PlatformEventType = keyof PlatformEventPayloadMap;

export interface PlatformEventOf<T extends PlatformEventType> {
  id: string;
  type: T;
  timestamp: number;
  source: EventSource;
  actor: Actor;
  target?: Actor;
  visible: boolean;
  payload: PlatformEventPayloadMap[T];
  metadata: EventMetadata;
}

export interface UnknownPlatformEvent {
  id: string;
  type: string;
  timestamp: number;
  source: EventSource;
  actor: Actor;
  target?: Actor;
  visible: boolean;
  payload: unknown;
  metadata: EventMetadata;
}

export type PlatformEvent = { [T in PlatformEventType]: PlatformEventOf<T> }[PlatformEventType];

export function isPlatformEventOf<T extends PlatformEventType>(
  event: PlatformEvent | UnknownPlatformEvent,
  type: T,
): event is PlatformEventOf<T> {
  return event.type === type;
}

export interface SerializedPlatformEvent<T extends PlatformEventType = PlatformEventType> {
  version: 1;
  id: string;
  type: T;
  timestamp: number;
  source: EventSource;
  actor: Actor;
  target?: Actor;
  payload: PlatformEventPayloadMap[T];
}

export function serializePlatformEvent<T extends PlatformEventType>(
  event: PlatformEventOf<T>,
): SerializedPlatformEvent<T> {
  const wire: SerializedPlatformEvent<T> = {
    version: 1,
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    source: event.source,
    actor: event.actor,
    payload: event.payload,
  };
  if (event.target) {
    wire.target = event.target;
  }
  return wire;
}

export function parsePlatformEvent(raw: unknown): PlatformEvent | UnknownPlatformEvent | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) {
    return null;
  }
  if (
    typeof obj.id !== "string" ||
    typeof obj.type !== "string" ||
    typeof obj.timestamp !== "number"
  ) {
    return null;
  }
  if (typeof obj.source !== "object" || obj.source === null) {
    return null;
  }
  if (!isEventSource(obj.source)) {
    return null;
  }
  if (typeof obj.actor !== "object" || obj.actor === null) {
    return null;
  }
  if (typeof (obj.actor as Record<string, unknown>).id !== "string") {
    return null;
  }
  if (!("payload" in obj)) {
    return null;
  }

  const base = {
    id: obj.id,
    timestamp: obj.timestamp,
    source: obj.source as EventSource,
    actor: obj.actor as Actor,
    visible: true,
    // 反序列化只为满足必填类型；这两个字段仅在分发路径有语义。
    metadata: { persist: true, triggerCandidate: false } satisfies EventMetadata,
  };

  if (obj.type === "message") {
    if (!isMessagePayload(obj.payload)) {
      return null;
    }
    return obj.target === undefined
      ? { ...base, type: "message", payload: obj.payload }
      : { ...base, type: "message", target: obj.target as Actor, payload: obj.payload };
  }

  return obj.target === undefined
    ? { ...base, type: obj.type, payload: obj.payload }
    : { ...base, type: obj.type, target: obj.target as Actor, payload: obj.payload };
}

function isEventSource(raw: unknown): raw is EventSource {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  return (
    typeof obj.platform === "string" &&
    typeof obj.channelId === "string" &&
    (obj.sourceType === "private" ||
      obj.sourceType === "group" ||
      obj.sourceType === "guild" ||
      obj.sourceType === "thread")
  );
}

function isMessagePayload(raw: unknown): raw is MessagePayload {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  return typeof obj.messageId === "string" && typeof obj.content === "string";
}

export interface AthenaEventEntry {
  type: "custom_message";
  customType: "athena:event";
  id?: string;
  content: UserContent;
  display?: boolean;
  details: unknown;
  timestamp?: string;
}

export function isAthenaEventEntry(raw: unknown): raw is AthenaEventEntry {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }

  const obj = raw as Record<string, unknown>;
  return (
    obj.type === "custom_message" &&
    obj.customType === "athena:event" &&
    "content" in obj &&
    "details" in obj
  );
}
