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

import type { ChannelBootstrapStatus, ChannelKey } from "../types";
import type {
  AgentMessage,
  AgentToolMessage,
  AgentToolResultPart,
  CompactionEntry,
  ContentPart,
  CustomEntry,
  CustomMessageEntry,
  FileEntry,
  ModelChangeEntry,
  SessionEntry,
  SessionHeader,
  SessionMessageEntry,
} from "./types";
import { CURRENT_SESSION_VERSION } from "./types";

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

/** Quick validation: reads only the first line to check if it's a valid session file. */
function isValidSessionFile(filePath: string): boolean {
  try {
    const fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(512);
    const bytesRead = readSync(fd, buffer, 0, 512, 0);
    closeSync(fd);
    const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n")[0];
    if (!firstLine) return false;
    const header = JSON.parse(firstLine);
    return header.type === "session" && typeof header.id === "string";
  } catch {
    return false;
  }
}

/** Find the most recent valid .jsonl session file in a directory. */
function findMostRecentSession(sessionDir: string): string | null {
  try {
    const files = readdirSync(sessionDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(sessionDir, f))
      .filter(isValidSessionFile)
      .map((path) => ({ path, mtime: statSync(path).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

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
 * Use buildSessionContext() (from context-builder.ts) to get the resolved
 * ModelMessage[] for the LLM.
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
    const mostRecent = findMostRecentSession(sessionDir);
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
      this.repairOrphanToolCalls();
    } else {
      const explicitPath = this.sessionFile;
      this.initNewSession();
      this.sessionFile = explicitPath;
    }
  }

  private repairOrphanToolCalls(): void {
    const pendingToolCalls = new Map<string, { toolCallId: string; toolName: string }>();

    for (const entry of this.fileEntries) {
      if (entry.type !== "message") continue;
      const msg = (entry as SessionMessageEntry).message;

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
    const entry: SessionMessageEntry = {
      type: "message",
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      message,
    };
    this.appendEntry(entry);
    return entry.id;
  }

  /** Append a custom message that participates in LLM context. */
  appendCustomMessageEntry<T = unknown>(
    customType: string,
    content: string | ContentPart[],
    display: boolean,
    details?: T,
  ): string {
    const entry: CustomMessageEntry<T> = {
      type: "custom_message",
      customType,
      content,
      display,
      details,
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
    };
    this.appendEntry(entry);
    return entry.id;
  }

  /** Append extension state (not in LLM context). */
  appendCustomEntry<T = unknown>(customType: string, data?: T): string {
    const entry: CustomEntry<T> = {
      type: "custom",
      customType,
      data,
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
    };
    this.appendEntry(entry);
    return entry.id;
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
