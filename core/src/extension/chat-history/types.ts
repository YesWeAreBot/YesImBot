// core/src/extension/chat-history/types.ts

// ============================================================================
// Configuration
// ============================================================================

export interface ChatHistoryConfig {
  sessionsDir: string;
  isolation: boolean;
  defaultLimit: number;
  maxLimit: number;
}

// ============================================================================
// Channel types
// ============================================================================

export interface ChannelLocator {
  platform: string;
  channelId: string;
  channelKey: string;
}

// ============================================================================
// Engine types
// ============================================================================

export interface SearchContext {
  sessionsDir: string;
  isolation: boolean;
  currentChannel: ChannelLocator | null;
  defaultLimit: number;
  maxLimit: number;
}

export interface ParsedMessage {
  id: string;
  timestamp: string;
  role: "user" | "assistant";
  speaker: string; // userId/nickname for user, "assistant" for assistant
  content: string; // full text content
  channelKey: string; // which channel this belongs to
}

export interface QueryValidation {
  valid: boolean;
  normalized?: string; // normalized query string
  hint?: string; // rejection reason
}

// ============================================================================
// Tool input types
// ============================================================================

export interface SearchConversationInput {
  query: string;
  where?: "here" | "all";
  user?: string;
  role?: "user" | "assistant";
  since?: string;
  until?: string;
  limit?: number;
}

export interface SearchUserActivityInput {
  user: string;
  query?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export interface ReadConversationContextInput {
  id: string;
  before?: number;
  after?: number;
}

// ============================================================================
// Tool output types
// ============================================================================

export interface SearchResult {
  id: string;
  time: string;
  speaker: string;
  snippet: string;
  channel?: string;
}

export interface SearchConversationOutput {
  results: SearchResult[];
  total_found: number;
  hint?: string;
}

export interface UserActivityChannel {
  channel: string;
  last_active: string;
  message_count: number;
  recent_messages: { id: string; time: string; snippet: string }[];
}

export interface SearchUserActivityOutput {
  activities: UserActivityChannel[];
  hint?: string;
}

export interface ReadConversationContextOutput {
  messages: string[];
  anchor_index: number;
  first_id: string;
  last_id: string;
  has_more_before: boolean;
  has_more_after: boolean;
  hint?: string;
}

// ============================================================================
// Internal types
// ============================================================================

export interface ToolError {
  error: string;
  code?: string;
  hint?: string;
}

export interface NormalizedChannelMeta {
  platform?: string;
  channelId?: string;
  type?: "private" | "group";
  currentSessionId?: string;
  lastActiveAt?: string;
  updatedAt?: string;
  sessionCount?: number;
}

export interface ChannelSummary extends ChannelLocator {
  type?: "group" | "private";
  currentSessionId?: string;
  sessionCount?: number;
  lastActiveAt?: string;
}

export interface SessionFileInfo {
  sessionId: string;
  filename: string;
  fullPath: string;
  size: number;
  modified: Date;
  isCurrent: boolean;
}

export interface ScanOptions {
  roleMatcher?: (role: "user" | "assistant") => boolean;
  senderMatcher?: (speaker: string) => boolean;
  contentMatcher?: (content: string) => boolean;
  since?: number;
  until?: number;
  maxLines?: number;
  maxHits?: number;
}
