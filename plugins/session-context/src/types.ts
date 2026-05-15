// ============================================================================
// 配置类型
// ============================================================================

export interface SessionContextConfig {
  /** 会话文件根目录（相对于 koishi app 目录） */
  sessionsDir: string;
  /** 隔离模式：true 只显示当前频道，false 显示所有频道 */
  isolation: boolean;
  /** search_session 默认返回条数 */
  defaultLimit: number;
  /** search_session 最大返回条数 */
  maxLimit: number;
}

// ============================================================================
// JSONL 解析类型
// ============================================================================

export interface ParsedEntry {
  timestamp: string;
  type: "user" | "assistant" | "session";
  sender?: string;
  content: string;
  sessionId?: string;
}

export interface JsonlFilter {
  messageTypes?: Set<string>;
  keyword?: RegExp;
  user?: string;
  since?: number;
  until?: number;
}

export interface SearchResults {
  results: ParsedEntry[];
  totalMatches: number;
  truncated: boolean;
  channelKey: string;
  filesSearched: number;
  filtered: { toolCalls: number; toolResults: number };
}

export interface ChannelInfo {
  channelKey: string;
  platform: string;
  channel: string;
  type: string;
  currentSession: string;
  sessionCount: number;
  lastMessage: string;
}

export interface SessionFileInfo {
  filename: string;
  size: number;
  modified: string;
}

export interface ListSessionsResult {
  channels?: ChannelInfo[];
  channelKey?: string;
  sessions?: SessionFileInfo[];
  currentSession?: string;
}

// ============================================================================
// 工具输入类型
// ============================================================================

export interface SearchSessionInput {
  keyword?: string;
  channelKey?: string;
  user?: string;
  messageTypes?: string[];
  since?: string;
  until?: string;
  sessionId?: string;
  limit?: number;
}

export interface ListSessionsInput {
  channelKey?: string;
}
