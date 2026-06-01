import type { UserContent } from "@yesimbot/agent/ai";

// ============================================================================
// PlatformEventType
// ============================================================================

export type PlatformEventType =
  | "message"
  | "message.recall"
  | "reaction"
  | "member"
  | "poke"
  | (string & {});

// ============================================================================
// Source & Actor (migrated from bot/types.ts)
// ============================================================================

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

// ============================================================================
// Payload types (migrated from bot/types.ts)
// ============================================================================

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

export interface AthenaEventMap {
  chat_message: ChatMessagePayload;
  member_change: MemberChangePayload;
  message_recall: MessageRecallPayload;
  reaction: ReactionPayload;
  poke: PokePayload;
}

export type AthenaEventKind = keyof AthenaEventMap;

export interface EventMetadata {
  persist: boolean;
  triggerCandidate: boolean;
}

export interface AthenaEvent<K extends AthenaEventKind = AthenaEventKind> {
  id: string;
  kind: K;
  timestamp: number;
  source: EventSource;
  actor: Actor;
  target?: Actor;
  payload: AthenaEventMap[K];
  metadata: EventMetadata;
}

export interface CreateAthenaEventInput<K extends AthenaEventKind> {
  source: EventSource;
  actor: Actor;
  target?: Actor;
  payload: AthenaEventMap[K];
  metadata: EventMetadata;
}

// ============================================================================
// Serialized event (for persistence)
// ============================================================================

export interface SerializedPlatformEvent {
  version: 1;
  id: string;
  /** @deprecated use `type` in PlatformEvent; kept in serialized form for backward compat */
  kind: string;
  timestamp: number;
  source: EventSource;
  actor: Actor;
  target?: Actor;
  payload: AthenaEventMap[keyof AthenaEventMap];
}

// ============================================================================
// PlatformEvent — unified event value object
// ============================================================================

export interface PlatformEvent {
  /** 事件唯一标识 */
  id: string;

  /** 事件语义类型 */
  type: PlatformEventType;

  /** 事件发生时间 (epoch ms) */
  timestamp: number;

  /** 来源平台与频道 */
  source: EventSource;

  /** 行为者 */
  actor: Actor;

  /** 行为目标（可选，如 poke 的 target） */
  target?: Actor;

  /** 给 LLM 消费的标准消息内容 */
  content: UserContent;

  /** 是否在 UI/历史中显示 */
  visible: boolean;

  /** 原始结构化载荷（供扩展和持久化使用） */
  details: unknown;

  /** 路由与触发元数据 */
  metadata: {
    /** 是否需要持久化到会话历史 */
    persist: boolean;
    /** 是否为触发候选（@ 机器人、私聊消息等） */
    triggerCandidate: boolean;
  };
}
