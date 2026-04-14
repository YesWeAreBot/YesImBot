import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import type { AssistantModelMessage, ModelMessage, ToolModelMessage } from "@ai-sdk/provider-utils";
import { JSONValue } from "ai";

import { materializeTimeline } from "./materialize";
import type {
  AssistantMessageRecord,
  ChannelMessageRecord,
  TimelineRecord,
  ToolMessageRecord,
} from "./types/index";
import type { ChannelBootstrapStatus, ChannelKey, ReplyReference } from "./types/index";

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

export interface TimelineEntry extends SessionEntryBase {
  type: "timeline";
  record: TimelineRecord;
}

// ============================================================================
// Union Types
// ============================================================================

export type SessionEntry =
  | TimelineEntry
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
export interface ChannelMessageDetails {
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

// ============================================================================
// Helpers
// ============================================================================

/** Generate a unique 8-char hex id, collision-checked against existing entries. */
function generateId(byId: { has(id: string): boolean }): string {
  for (let i = 0; i < 100; i++) {
    const id = randomUUID().slice(0, 8);
    if (!byId.has(id)) return id;
  }
  return randomUUID();
}

/** Parse a JSONL file into FileEntry array. Returns empty array on invalid/empty. */
export function loadEntriesFromFile(filePath: string): FileEntry[] {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, "utf8");
  const entries: FileEntry[] = [];
  const lines = content.trim().split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as FileEntry);
    } catch {
      // Skip malformed lines
    }
  }

  if (entries.length === 0) return [];
  const header = entries[0];
  if (header.type !== "session" || typeof (header as SessionHeader).id !== "string") {
    return [];
  }

  return entries;
}

function readSessionHeader(filePath: string): SessionHeader | null {
  try {
    const fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(512);
    const bytesRead = readSync(fd, buffer, 0, 512, 0);
    closeSync(fd);
    const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n")[0];
    if (!firstLine) return null;
    const header = JSON.parse(firstLine);
    if (header.type !== "session" || typeof header.id !== "string") {
      return null;
    }
    return header as SessionHeader;
  } catch {
    return null;
  }
}

/** Find the most recent valid .jsonl session file in a directory. */
function findMostRecentSession(sessionDir: string, channelKey: ChannelKey): string | null {
  try {
    const files = readdirSync(sessionDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(sessionDir, f))
      .map((path) => ({
        path,
        header: readSessionHeader(path),
        mtime: statSync(path).mtime.getTime(),
      }))
      .filter(
        (file): file is { path: string; header: SessionHeader; mtime: number } =>
          file.header !== null && file.header.channelKey === channelKey,
      )
      .sort((a, b) => {
        if (b.mtime !== a.mtime) {
          return b.mtime - a.mtime;
        }

        const timestampDelta = Date.parse(b.header.timestamp) - Date.parse(a.header.timestamp);
        if (timestampDelta !== 0) {
          return timestampDelta;
        }

        return b.path.localeCompare(a.path);
      });

    return files[0]?.path ?? null;
  } catch {
    return null;
  }
}

/** Run migrations to bring entries to current version. Returns true if migrated. */
function migrateToCurrentVersion(entries: FileEntry[]): boolean {
  const header = entries.find((e) => e.type === "session") as SessionHeader | undefined;
  const version = header?.version ?? 1;
  if (version >= CURRENT_SESSION_VERSION) return false;
  // Future migrations go here
  return false;
}

function serializeFileEntry(entry: FileEntry): string {
  switch (entry.type) {
    case "session":
      return JSON.stringify({
        type: entry.type,
        version: entry.version,
        id: entry.id,
        channelKey: entry.channelKey,
        timestamp: entry.timestamp,
        modelId: entry.modelId,
      });
    case "model_change":
      return JSON.stringify({
        type: entry.type,
        provider: entry.provider,
        modelId: entry.modelId,
        id: entry.id,
        parentId: entry.parentId,
        timestamp: entry.timestamp,
      });
    case "timeline":
      return JSON.stringify({
        type: entry.type,
        record: entry.record,
        id: entry.id,
        parentId: entry.parentId,
        timestamp: entry.timestamp,
      });
    case "custom_message":
      return JSON.stringify({
        type: entry.type,
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        id: entry.id,
        parentId: entry.parentId,
        timestamp: entry.timestamp,
      });
    case "message":
      return JSON.stringify({
        type: entry.type,
        id: entry.id,
        parentId: entry.parentId,
        timestamp: entry.timestamp,
        message: entry.message,
      });
    case "compaction":
      return JSON.stringify({
        type: entry.type,
        summary: entry.summary,
        firstKeptEntryId: entry.firstKeptEntryId,
        tokensBefore: entry.tokensBefore,
        id: entry.id,
        parentId: entry.parentId,
        timestamp: entry.timestamp,
      });
    case "custom":
      return JSON.stringify({
        type: entry.type,
        customType: entry.customType,
        data: entry.data,
        id: entry.id,
        parentId: entry.parentId,
        timestamp: entry.timestamp,
      });
    default:
      return JSON.stringify(entry);
  }
}

function channelKeyToParts(channelKey: ChannelKey): { platform: string; channelId: string } {
  const [platform, channelId] = channelKey.split(":", 2);
  return {
    platform,
    channelId,
  };
}

function contentPartsToString(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function legacyMessageToTimelineRecord(
  message: AgentMessage,
  channelKey: ChannelKey,
  id: string,
): TimelineRecord {
  const { platform, channelId } = channelKeyToParts(channelKey);

  switch (message.role) {
    case "assistant":
      return {
        id,
        kind: "assistant_message",
        timestamp: message.timestamp,
        stage: "runtime",
        visibility: "model",
        materialization: "default",
        message: assistantToModelMessage(message),
      } satisfies AssistantMessageRecord;
    case "tool":
      return {
        id,
        kind: "tool_message",
        timestamp: message.timestamp,
        stage: "runtime",
        visibility: "model",
        materialization: "default",
        message: toolToModelMessage(message),
      } satisfies ToolMessageRecord;
    case "user":
      return {
        id,
        kind: "channel_message",
        timestamp: message.timestamp,
        stage: "ingress",
        visibility: "model",
        materialization: "default",
        message: {
          kind: "channel_message",
          platform,
          channelId,
          messageId: id,
          timestamp: message.timestamp,
          content: contentPartsToString(message.content),
          sender: {
            userId: "user",
            username: "user",
          },
          isDirect: false,
          atSelf: false,
          isReplyToBot: false,
        },
      } satisfies ChannelMessageRecord;
    case "custom":
      return legacyCustomMessageToTimelineRecord(
        message.customType,
        message.content,
        message.details,
        id,
      );
  }
}

function legacyCustomMessageToTimelineRecord<T>(
  customType: string,
  content: string | ContentPart[],
  details: T | undefined,
  id: string,
): TimelineRecord {
  switch (customType) {
    case "channel_message": {
      const messageDetails = details as ChannelMessageDetails | undefined;
      return {
        id,
        kind: "channel_message",
        timestamp: messageDetails?.timestamp ?? Date.now(),
        stage: "ingress",
        visibility: "model",
        materialization: "default",
        message: {
          kind: "channel_message",
          platform: messageDetails?.platform ?? "unknown",
          channelId: messageDetails?.channelId ?? "unknown",
          messageId: messageDetails?.messageId ?? id,
          timestamp: messageDetails?.timestamp ?? Date.now(),
          content: contentPartsToString(content),
          sender: {
            userId: messageDetails?.userId ?? "unknown",
            username: messageDetails?.username ?? "unknown",
            nickname: messageDetails?.nickname,
            identity: messageDetails?.identity,
          },
          isDirect: messageDetails?.isDirect ?? false,
          atSelf: messageDetails?.atSelf ?? false,
          isReplyToBot: messageDetails?.isReplyToBot ?? false,
          replyTo: messageDetails?.replyTo,
        },
      } satisfies ChannelMessageRecord;
    }
  }

  return {
    id,
    kind: "system_notice",
    timestamp: Date.now(),
    stage: "runtime",
    visibility: "hidden",
    materialization: "hidden",
    subType: customType,
    materializationKey: "hidden",
    notice: contentPartsToString(content),
    data: details as JSONValue | undefined,
  } as TimelineRecord;
}

function legacyStateToTimelineRecord<T>(
  customType: string,
  data: T | undefined,
  id: string,
): TimelineRecord {
  return {
    id,
    kind: "state_change",
    timestamp: Date.now(),
    stage: "runtime",
    visibility: "internal",
    materialization: "internal",
    stateType: customType,
    data: data as JSONValue | undefined,
  } as TimelineRecord;
}

function entryToTimelineRecord(entry: SessionEntry): TimelineRecord | null {
  switch (entry.type) {
    case "timeline":
      return entry.record;
    case "message":
      return legacyMessageToTimelineRecord(entry.message, "unknown:unknown", entry.id);
    case "custom_message":
      return legacyCustomMessageToTimelineRecord(
        entry.customType,
        entry.content,
        entry.details,
        entry.id,
      );
    case "custom":
      return legacyStateToTimelineRecord(entry.customType, entry.data, entry.id);
    default:
      return null;
  }
}

// ============================================================================
// SessionManager
// ============================================================================

/**
 * Manages a single session as a linear append-only JSONL file.
 *
 * Each entry has an id and parentId forming a linear chain. The "leaf"
 * pointer tracks the most recent entry. Appending creates a new entry
 * whose parentId is the current leaf, then advances the leaf.
 *
 * Canonical timeline records remain the durable truth, while read-side callers
 * should use `getTimeline()` or `getModelMessages()` for derived projections.
 */
export class SessionManager {
  private sessionId = "";
  private channelKey: ChannelKey;
  private sessionDir: string;
  private sessionFile: string | undefined;
  private persist: boolean;
  private flushed = false;
  private fileEntries: FileEntry[] = [];
  private byId: Map<string, SessionEntry> = new Map();
  private leafId: string | null = null;

  // =========================================================================
  // Private Constructor
  // =========================================================================

  private constructor(channelKey: ChannelKey, sessionDir: string, persist: boolean) {
    this.channelKey = channelKey;
    this.sessionDir = sessionDir;
    this.persist = persist;

    if (persist && sessionDir && !existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }
  }

  // =========================================================================
  // Static Factory Methods
  // =========================================================================

  /** Create a brand new session for a channel. */
  static create(channelKey: ChannelKey, sessionDir: string, modelId?: string): SessionManager {
    const mgr = new SessionManager(channelKey, sessionDir, true);
    mgr.initNewSession(modelId);
    return mgr;
  }

  /** Open an existing session file. */
  static open(sessionFile: string, channelKey: ChannelKey): SessionManager {
    const dir = resolve(sessionFile, "..");
    const mgr = new SessionManager(channelKey, dir, true);
    mgr.loadSessionFile(sessionFile);
    return mgr;
  }

  /**
   * Continue the most recent session for a channel, or return null if none found.
   * Call `SessionManager.create()` as fallback.
   */
  static continueRecent(channelKey: ChannelKey, sessionDir: string): SessionManager | null {
    if (!existsSync(sessionDir)) return null;
    const mostRecent = findMostRecentSession(sessionDir, channelKey);
    if (!mostRecent) return null;

    const mgr = new SessionManager(channelKey, sessionDir, true);
    mgr.loadSessionFile(mostRecent);
    return mgr;
  }

  static restoreOrCreateRecent(
    channelKey: ChannelKey,
    sessionDir: string,
    modelId?: string,
  ): {
    sessionManager: SessionManager;
    status: Extract<ChannelBootstrapStatus, "restored" | "created">;
  } {
    const restored = SessionManager.continueRecent(channelKey, sessionDir);
    if (restored) {
      return {
        sessionManager: restored,
        status: "restored",
      };
    }

    return {
      sessionManager: SessionManager.create(channelKey, sessionDir, modelId),
      status: "created",
    };
  }

  /** Create an in-memory session (no file persistence). For testing. */
  static inMemory(channelKey: ChannelKey): SessionManager {
    const mgr = new SessionManager(channelKey, "", false);
    mgr.initNewSession();
    return mgr;
  }

  // =========================================================================
  // Internal Init
  // =========================================================================

  private initNewSession(modelId?: string): void {
    this.sessionId = randomUUID();
    const timestamp = new Date().toISOString();
    const header: SessionHeader = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: this.sessionId,
      channelKey: this.channelKey,
      timestamp,
      modelId,
    };
    this.fileEntries = [header];
    this.byId.clear();
    this.leafId = null;
    this.flushed = false;

    if (this.persist) {
      const fileTimestamp = timestamp.replace(/[:.]/g, "-");
      this.sessionFile = join(this.sessionDir, `${fileTimestamp}_${this.sessionId}.jsonl`);
    }
  }

  private loadSessionFile(filePath: string): void {
    this.sessionFile = resolve(filePath);

    if (existsSync(this.sessionFile)) {
      this.fileEntries = loadEntriesFromFile(this.sessionFile);

      if (this.fileEntries.length === 0) {
        // Corrupted or empty file — start fresh but keep the explicit path
        const explicitPath = this.sessionFile;
        this.initNewSession();
        this.sessionFile = explicitPath;
        this.rewriteFile();
        this.flushed = true;
        return;
      }

      const header = this.fileEntries.find((e) => e.type === "session") as
        | SessionHeader
        | undefined;
      this.sessionId = header?.id ?? randomUUID();

      if (migrateToCurrentVersion(this.fileEntries)) {
        this.rewriteFile();
      }

      this.buildIndex();
      this.flushed = true;
      this.repairUnresolvedToolCalls();
    } else {
      const explicitPath = this.sessionFile;
      this.initNewSession();
      this.sessionFile = explicitPath;
    }
  }

  private repairUnresolvedToolCalls(): void {
    const pendingToolCalls = new Map<string, { toolCallId: string; toolName: string }>();

    for (const entry of this.fileEntries) {
      if (entry.type === "message") {
        const msg = entry.message;

        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === "tool-call") {
              pendingToolCalls.set(part.toolCallId, {
                toolCallId: part.toolCallId,
                toolName: part.toolName,
              });
            }
          }
        }

        if (msg.role === "tool") {
          for (const part of msg.content) {
            pendingToolCalls.delete(part.toolCallId);
          }
        }

        continue;
      }

      if (entry.type !== "timeline") continue;

      if (
        entry.record.kind === "assistant_message" &&
        Array.isArray(entry.record.message.content)
      ) {
        for (const part of entry.record.message.content) {
          if (part.type === "tool-call") {
            pendingToolCalls.set(part.toolCallId, {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
            });
          }
        }
      }

      if (entry.record.kind === "tool_message") {
        for (const part of entry.record.message.content) {
          if (part.type === "tool-result") {
            pendingToolCalls.delete(part.toolCallId);
          }
        }
      }
    }

    if (pendingToolCalls.size === 0) {
      return;
    }

    const syntheticResults: AgentToolResultPart[] = [...pendingToolCalls.values()].map((tc) => ({
      type: "tool-result",
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      result: "Session interrupted before tool execution completed",
      isError: true,
    }));

    const repairMessage: AgentToolMessage = {
      role: "tool",
      content: syntheticResults,
      timestamp: Date.now(),
    };

    this.appendMessage(repairMessage);
  }

  private buildIndex(): void {
    this.byId.clear();
    this.leafId = null;
    for (const entry of this.fileEntries) {
      if (entry.type === "session") continue;
      this.byId.set(entry.id, entry);
      this.leafId = entry.id;
    }
  }

  private rewriteFile(): void {
    if (!this.persist || !this.sessionFile) return;
    const content = `${this.fileEntries.map((e) => serializeFileEntry(e)).join("\n")}\n`;
    writeFileSync(this.sessionFile, content);
  }

  // =========================================================================
  // Read Methods
  // =========================================================================

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  getSessionFile(): string | undefined {
    return this.sessionFile;
  }

  getChannelKey(): ChannelKey {
    return this.channelKey;
  }

  getLeafId(): string | null {
    return this.leafId;
  }

  getHeader(): SessionHeader {
    return this.fileEntries[0] as SessionHeader;
  }

  getEntries(): readonly SessionEntry[] {
    return this.fileEntries.filter((e): e is SessionEntry => e.type !== "session");
  }

  getTimeline(): TimelineRecord[] {
    return this.getEntries()
      .map((entry) => entryToTimelineRecord(entry))
      .filter((entry): entry is TimelineRecord => entry !== null);
  }

  getModelMessages(): ModelMessage[] {
    return materializeTimeline(this.getTimeline());
  }

  getEntry(id: string): SessionEntry | undefined {
    return this.byId.get(id);
  }

  getEntryCount(): number {
    return this.byId.size;
  }

  isPersisted(): boolean {
    return this.persist;
  }

  // =========================================================================
  // Append Methods — all return entry id
  // =========================================================================

  /** Append a user/custom/assistant/tool message. */
  appendMessage(message: AgentMessage): string {
    const id = generateId(this.byId);
    const record = legacyMessageToTimelineRecord(message, this.channelKey, id);
    return this.appendTimelineRecord(record);
  }

  /** Append a custom message that participates in LLM context. */
  appendCustomMessageEntry<T = unknown>(
    customType: string,
    content: string | ContentPart[],
    display: boolean,
    details?: T,
  ): string {
    void display;
    const id = generateId(this.byId);
    const record = legacyCustomMessageToTimelineRecord(customType, content, details, id);
    return this.appendTimelineRecord(record);
  }

  /** Append extension state (not in LLM context). */
  appendCustomEntry<T = unknown>(customType: string, data?: T): string {
    const id = generateId(this.byId);
    const record = legacyStateToTimelineRecord(customType, data, id);
    return this.appendTimelineRecord(record);
  }

  appendTimelineRecord(record: TimelineRecord): string {
    const entry: TimelineEntry = {
      type: "timeline",
      id: record.id,
      parentId: this.leafId,
      timestamp: new Date(record.timestamp).toISOString(),
      record,
    };
    this.appendEntry(entry);
    return record.id;
  }

  /** Append a compaction summary. */
  appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number): string {
    const entry: CompactionEntry = {
      type: "compaction",
      summary,
      firstKeptEntryId,
      tokensBefore,
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
    };
    this.appendEntry(entry);
    return entry.id;
  }

  /** Append a model change record. */
  appendModelChange(provider: string, modelId: string): string {
    const entry: ModelChangeEntry = {
      type: "model_change",
      provider,
      modelId,
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
    };
    this.appendEntry(entry);
    return entry.id;
  }

  // =========================================================================
  // Internal Persistence
  // =========================================================================

  private appendEntry(entry: SessionEntry): void {
    this.fileEntries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this.persistEntry(entry);
  }

  /**
   * Persist-first strategy:
   * 1. Create the file on first append.
   * 2. On first flush, write all accumulated entries at once.
   * 3. After that, append each new entry individually.
   */
  private persistEntry(entry: SessionEntry): void {
    if (!this.persist || !this.sessionFile) return;

    if (!this.flushed) {
      const dir = resolve(this.sessionFile, "..");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.sessionFile, "");
      for (const e of this.fileEntries) {
        appendFileSync(this.sessionFile, `${serializeFileEntry(e)}\n`);
      }
      this.flushed = true;
    } else {
      appendFileSync(this.sessionFile, `${serializeFileEntry(entry)}\n`);
    }
  }
}

// ============================================================================
// AgentMessage → AI SDK ModelMessage conversion
// ============================================================================

function assistantToModelMessage(msg: AgentAssistantMessage): AssistantModelMessage {
  if (typeof msg.content === "string") {
    return { role: "assistant", content: msg.content };
  }
  const content = msg.content.map((part) => {
    switch (part.type) {
      case "text":
        return { type: "text" as const, text: part.text };
      case "tool-call":
        return {
          type: "tool-call" as const,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.args,
        };
      case "thinking":
        return { type: "reasoning" as const, text: part.text };
    }
  });
  return { role: "assistant", content } as AssistantModelMessage;
}

function toolToModelMessage(msg: AgentToolMessage): ToolModelMessage {
  return {
    role: "tool",
    content: msg.content.map((part) => ({
      type: "tool-result" as const,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: { type: "json" as const, value: part.result as JSONValue },
      isError: part.isError,
    })),
  };
}

// ============================================================================
// AI SDK helpers
// ============================================================================

/** Extract text from an AI SDK ResponseMessage for sending to channel. */
export function extractTextFromResponseMessages(messages: readonly ModelMessage[]): string {
  const texts: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    if (typeof msg.content === "string") {
      texts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if ("text" in part && part.type === "text") {
          texts.push(part.text);
        }
      }
    }
  }
  return texts.join("");
}
