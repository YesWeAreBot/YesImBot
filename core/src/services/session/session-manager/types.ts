import type { ChannelKey } from "../types";
import type { ReplyReference } from "../types";

// ============================================================================
// Session File Version
// ============================================================================

export const CURRENT_SESSION_VERSION = 1;

// ============================================================================
// Content Parts (shared)
// ============================================================================

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image";
  image: string | URL | Uint8Array;
  mimeType?: string;
}

export type ContentPart = TextPart | ImagePart;

// ============================================================================
// AgentMessage Types — persistable/runtime message types with metadata
// ============================================================================

export interface AgentUserMessage {
  role: "user";
  content: string | ContentPart[];
  timestamp: number;
}

export interface AgentTextPart {
  type: "text";
  text: string;
}

export interface AgentToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface AgentAssistantThinkingPart {
  type: "thinking";
  text: string;
  signature?: string;
}

export type AgentAssistantContentPart =
  | AgentTextPart
  | AgentToolCallPart
  | AgentAssistantThinkingPart;

export interface AgentCustomMessage<T = unknown> {
  role: "custom";
  customType: string;
  content: string | ContentPart[];
  display: boolean;
  details?: T;
  timestamp: number;
}

export interface AgentAssistantMessage {
  role: "assistant";
  content: string | AgentAssistantContentPart[];
  timestamp: number;
  provider: string;
  model: string;
  usage?: AgentUsage;
  finishReason?: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface AgentToolResultPart {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

export interface AgentToolMessage {
  role: "tool";
  content: AgentToolResultPart[];
  timestamp: number;
}

export type AgentMessage =
  | AgentUserMessage
  | AgentCustomMessage
  | AgentAssistantMessage
  | AgentToolMessage;

// ============================================================================
// Session Header — first line of JSONL file
// ============================================================================

export interface SessionHeader {
  type: "session";
  version: number;
  id: string;
  channelKey: ChannelKey;
  timestamp: string;
  modelId?: string;
}

// ============================================================================
// Session Entry Types — all entries after header
// ============================================================================

export interface SessionEntryBase {
  type: string;
  /** Unique 8-char hex id within this session file. */
  id: string;
  /** Previous entry's id. Null for the first entry after header. */
  parentId: string | null;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/** Wraps an AgentMessage (user / custom / assistant / tool). */
export interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}

/**
 * Extension message that participates in LLM context.
 * Used for channel chat messages, system events, image cache, etc.
 *
 * - `content` is sent to LLM (formatted text or structured parts).
 * - `details` carries metadata that is NOT sent to LLM.
 */
export interface CustomMessageEntry<T = unknown> extends SessionEntryBase {
  type: "custom_message";
  customType: string;
  content: string | ContentPart[];
  details?: T;
  display: boolean;
}

/**
 * Extension state that does NOT participate in LLM context.
 * Used to persist arbitrary state across session reloads.
 */
export interface CustomEntry<T = unknown> extends SessionEntryBase {
  type: "custom";
  customType: string;
  data?: T;
}

/** Context compaction summary. Entries before `firstKeptEntryId` are summarized. */
export interface CompactionEntry extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
}

/** Records a model switch within the session. */
export interface ModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

// ============================================================================
// Union Types
// ============================================================================

export type SessionEntry =
  | SessionMessageEntry
  | CustomMessageEntry
  | CustomEntry
  | CompactionEntry
  | ModelChangeEntry;

export type FileEntry = SessionHeader | SessionEntry;

// ============================================================================
// Channel Message Details — metadata for CustomMessageEntry
// ============================================================================

/** Structured metadata stored in `details` of a channel_message CustomMessageEntry. */
export type ChannelMessageDetails = InboundChannelMessageDetails | OutboundChannelMessageDetails;

export interface InboundChannelMessageDetails {
  direction: "inbound";
  timestamp: number;
  userId: string;
  username: string;
  nickname: string;
  identity: string;
  platform: string;
  channelId: string;
  messageId: string;
  isDirect: boolean;
  atSelf: boolean;
  isReplyToBot: boolean;
  replyTo?: ReplyReference;
}

export interface OutboundChannelMessageDetails {
  direction: "outbound";
  platform: string;
  channelId: string;
  toolCallId: string;
  utteranceId: string;
  index: number;
  messageIds?: string[];
  requestHeartbeat: boolean;
}

// ============================================================================
// Session Context — output of buildSessionContext()
// ============================================================================

export interface SessionContext {
  agentMessages: AgentMessage[];
  model: { provider: string; modelId: string } | null;
  entryCount: number;
}
