import type { UserContent } from "@yesimbot/agent/ai";
import type { Element, Fragment, Session } from "koishi";

export interface EventSource {
  platform: string;
  channelId: string;
  guildId?: string;
  threadId?: string;
  conversationType: "private" | "group" | "guild" | "thread";
  selfId?: string;
}

export interface Actor {
  id: string;
  name?: string;
  avatar?: string;
  isSelf?: boolean;
}

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

export interface SerializedAthenaEvent<K extends AthenaEventKind = AthenaEventKind> {
  version: 1;
  id: string;
  kind: K;
  timestamp: number;
  source: EventSource;
  actor: Actor;
  target?: Actor;
  payload: AthenaEventMap[K];
}

export interface BotPresentation<TDetails = unknown> {
  visible: boolean;
  content: UserContent;
  details: TDetails;
  text?: string;
}

export interface SpeakElementContext {
  channel: { platform: string; channelId: string; type: "private" | "group" };
  session?: Session;
}

export interface SpeakElementDefinition {
  tag: string;
  syntax: string;
  description: string;
  examples?: string[];
  transform?: (element: Element, context: SpeakElementContext) => Fragment | Promise<Fragment>;
}

export interface SpeakElementPromptInfo {
  tag: string;
  syntax: string;
  description: string;
  examples: string[];
}

export interface SpeakAnomaly {
  version: 1;
  kind: "transform_failed" | "send_failed" | "partial_failed" | "cancelled";
  timestamp: number;
  source: "athena-bot";
  reason: string;
  generatedContent: string;
  attemptedSegments: string[];
  deliveredSegments?: string[];
  failedSegments?: string[];
  error?: unknown;
}
