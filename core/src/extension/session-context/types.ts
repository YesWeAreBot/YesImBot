export interface SessionContextConfig {
  sessionsDir: string;
  isolation: boolean;
  defaultLimit: number;
  maxLimit: number;
}

// ============================================================================
// JSONL 解析类型
// ============================================================================

export interface ParsedEntry {
  timestamp: string;
  type: "user" | "assistant" | "session";
  senderId?: string;
  content: string;
  sessionId?: string;
}

export interface FilteredStats {
  toolCall: number;
  toolResult: number;
  sessionInfo: number;
  malformed: number;
  emptyText: number;
}

export interface JsonlFilter {
  messageTypes?: Set<"user" | "assistant" | "session">;
  senderId?: string;
  senderMatcher?: (senderId: string | undefined) => boolean;
  contentMatcher?: (content: string) => boolean;
  since?: number;
  until?: number;
}

// ============================================================================
// 工具输入类型
// ============================================================================

export interface SearchSessionInput {
  query?: string;
  isRegex?: boolean;
  scope?: "current" | "channel" | "global";
  platform?: string;
  channelId?: string;
  channelKey?: string;
  senderId?: string;
  senderQuery?: string;
  messageTypes?: Array<"user" | "assistant" | "session">;
  since?: string;
  until?: string;
  sessionId?: string;
  limit?: number;
  channelLimit?: number;
  sort?: "asc" | "desc";
  keyword?: string;
  user?: string;
}

export interface ListSessionsInput {
  current?: boolean;
  platform?: string;
  channelId?: string;
  channelKey?: string;
  limit?: number;
  sort?: "modified_desc" | "modified_asc";
}

// ============================================================================
// Channel Locator 类型
// ============================================================================

export interface ToolError {
  error: string;
  code?: string;
  hint?: string;
}

export interface ChannelLocator {
  platform: string;
  channelId: string;
  channelKey: string;
}

export interface ResolveChannelLocatorInput {
  sessionsDir: string;
  isolation: boolean;
  currentChannel: ChannelLocator | null;
  platform?: string;
  channelId?: string;
  channelKey?: string;
  current?: boolean;
}

export interface ChannelSummary extends ChannelLocator {
  type?: "group" | "private";
  currentSessionId?: string;
  sessionCount?: number;
  lastActiveAt?: string;
  matchReason: string;
}

export interface FindChannelsInput {
  platform?: string;
  channelId?: string;
  channelIdQuery?: string;
  channelKey?: string;
  type?: "group" | "private";
  limit?: number;
  sortBy?: "recent" | "sessionCount";
}

export interface ReadSessionWindowInput {
  current?: boolean;
  platform?: string;
  channelId?: string;
  channelKey?: string;
  sessionId: string;
  anchorTimestamp?: string;
  anchorQuery?: string;
  before?: number;
  after?: number;
  messageTypes?: Array<"user" | "assistant" | "session">;
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
