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

import type { AssistantModelMessage, ModelMessage, UserModelMessage } from "@ai-sdk/provider-utils";
import { JSONValue } from "ai";

import { convertToLlm } from "./materialize";
import type {
  ActivationReason,
  ActivationResultEntry,
  AssistantMessage,
  AthenaMessage,
  ChannelKey,
  CompactionEntry,
  ResponseStatusEntry,
  ResponseStatusReason,
  SessionEntry,
  SessionHeader,
  SessionInfoEntry,
  SessionMessage,
  SessionMessageEntry,
  ToolResultMessage,
} from "./messages";

export const CURRENT_SESSION_VERSION = 1;

const LEGACY_INCOMPATIBLE_ERROR =
  "Incompatible legacy session JSONL: timeline/custom/model_change rows are not supported.";

// ============================================================================
// Message content types consumed by runtime (compat exports)
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

export interface AgentTextPart {
  type: "text";
  text: string;
}

export type AgentAssistantContentPart =
  | AgentTextPart
  | AgentToolCallPart
  | AgentAssistantThinkingPart;

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface AgentUserMessage {
  role: "user";
  content: string | ContentPart[];
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

export interface AgentCustomMessage<T = unknown> {
  role: "custom";
  customType: string;
  content: string | ContentPart[];
  display: boolean;
  details?: T;
  timestamp: number;
}

export type AgentMessage =
  | AgentUserMessage
  | AgentAssistantMessage
  | AgentToolMessage
  | AgentCustomMessage;

type PersistedEntry = SessionHeader | Exclude<SessionEntry, SessionHeader>;

function generateId(byId: { has(id: string): boolean }): string {
  for (let i = 0; i < 100; i++) {
    const id = randomUUID().slice(0, 8);
    if (!byId.has(id)) {
      return id;
    }
  }

  return randomUUID();
}

function ensureIsoTimestamp(input: string | number | Date): string {
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return new Date(input).toISOString();
}

function readSessionHeader(filePath: string): SessionHeader | null {
  try {
    const fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(1024);
    const bytesRead = readSync(fd, buffer, 0, 1024, 0);
    closeSync(fd);
    const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n")[0];
    if (!firstLine) {
      return null;
    }

    const parsed = JSON.parse(firstLine) as Record<string, unknown>;
    if (parsed.type !== "session" || typeof parsed.id !== "string") {
      return null;
    }

    return parsed as unknown as SessionHeader;
  } catch {
    return null;
  }
}

function findMostRecentSession(sessionDir: string, channelKey: ChannelKey): string | null {
  try {
    const files = readdirSync(sessionDir)
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => join(sessionDir, file))
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

        const tsDelta = Date.parse(b.header.timestamp) - Date.parse(a.header.timestamp);
        if (tsDelta !== 0) {
          return tsDelta;
        }

        return b.path.localeCompare(a.path);
      });

    return files[0]?.path ?? null;
  } catch {
    return null;
  }
}

function parseSessionLine(obj: Record<string, unknown>): PersistedEntry {
  if (obj.type === "session") {
    return obj as unknown as SessionHeader;
  }

  const type = obj.type;
  if (
    type === "timeline" ||
    type === "custom" ||
    type === "custom_message" ||
    type === "model_change"
  ) {
    throw new Error(LEGACY_INCOMPATIBLE_ERROR);
  }

  if (
    type !== "message" &&
    type !== "activation_result" &&
    type !== "response_status" &&
    type !== "compaction" &&
    type !== "session_info"
  ) {
    throw new Error(`Unsupported session entry type: ${String(type)}`);
  }

  return obj as unknown as Exclude<SessionEntry, SessionHeader>;
}

export function loadEntriesFromFile(filePath: string): PersistedEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = readFileSync(filePath, "utf8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const parsed = lines.map((line) => parseSessionLine(JSON.parse(line) as Record<string, unknown>));
  const header = parsed[0];
  if (header.type !== "session") {
    throw new Error("Invalid session file: first row must be type=session");
  }

  return parsed;
}

function serializeEntry(entry: PersistedEntry): string {
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
    case "message":
      return JSON.stringify({
        type: entry.type,
        id: entry.id,
        parentId: entry.parentId,
        timestamp: entry.timestamp,
        message: entry.message,
      });
    case "activation_result":
      return JSON.stringify({
        type: entry.type,
        id: entry.id,
        parentId: entry.parentId,
        timestamp: entry.timestamp,
        batchId: entry.batchId,
        activated: entry.activated,
        reasons: entry.reasons,
      });
    case "response_status":
      return JSON.stringify({
        type: entry.type,
        id: entry.id,
        parentId: entry.parentId,
        timestamp: entry.timestamp,
        endReason: entry.endReason,
        nextAction: entry.nextAction,
        stepsCompleted: entry.stepsCompleted,
        durationMs: entry.durationMs,
        error: entry.error,
        blockedReason: entry.blockedReason,
      });
    case "compaction":
      return JSON.stringify({
        type: entry.type,
        id: entry.id,
        parentId: entry.parentId,
        timestamp: entry.timestamp,
        summary: entry.summary,
        firstKeptEntryId: entry.firstKeptEntryId,
        tokensBefore: entry.tokensBefore,
      });
    case "session_info":
      return JSON.stringify({
        type: entry.type,
        id: entry.id,
        parentId: entry.parentId,
        timestamp: entry.timestamp,
        infoType: entry.infoType,
        provider: entry.provider,
        modelId: entry.modelId,
        stateType: entry.infoType === "runtime_state" ? entry.stateType : undefined,
        data: entry.infoType === "runtime_state" ? entry.data : undefined,
      });
  }
}

function contentPartsToString(content: string | ContentPart[]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function agentMessageToSessionMessage(message: AgentMessage): SessionMessage {
  switch (message.role) {
    case "user":
      return {
        type: "user.message",
        timestamp: ensureIsoTimestamp(message.timestamp),
        data: {
          messageId: `legacy-user-${message.timestamp}`,
          senderId: "user",
          content: contentPartsToString(message.content),
        },
      };
    case "assistant":
      return assistantToSessionMessage({
        role: "assistant",
        content:
          typeof message.content === "string"
            ? message.content
            : message.content.map((part) => {
                switch (part.type) {
                  case "text":
                    return { type: "text" as const, text: part.text };
                  case "thinking":
                    return {
                      type: "reasoning" as const,
                      text: part.text,
                      signature: part.signature,
                    };
                  case "tool-call":
                    return {
                      type: "tool-call" as const,
                      toolCallId: part.toolCallId,
                      toolName: part.toolName,
                      input: part.args,
                    };
                }
              }),
      });
    case "tool":
      return toolToSessionMessage({
        role: "tool",
        content: message.content.map((part) => ({
          type: "tool-result" as const,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: {
            type: "json" as const,
            value: part.result as JSONValue,
          },
          isError: part.isError,
        })),
      });
    case "custom":
      return {
        type: "notice.state.update",
        timestamp: ensureIsoTimestamp(message.timestamp),
        data: {
          content: `[custom] ${message.customType}: ${contentPartsToString(message.content)}`,
        },
      };
  }
}

function assistantToSessionMessage(message: AssistantModelMessage): AssistantMessage {
  return {
    ...message,
    role: "assistant",
    content: message.content,
  };
}

function toolToSessionMessage(message: ToolResultMessage): ToolResultMessage {
  return {
    ...message,
    role: "tool",
    content: message.content,
  };
}

function getToolResultIds(message: SessionMessage): Set<string> {
  if (!("role" in message) || message.role !== "tool") {
    return new Set();
  }

  return new Set(message.content.map((part) => part.toolCallId));
}

function createInterruptedToolResult(toolCallId: string, toolName: string): ToolResultMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        output: {
          type: "json",
          value: "Session interrupted before tool execution completed",
        },
      },
    ],
  };
}

export class SessionManager {
  private sessionId = "";
  private channelKey: ChannelKey;
  private sessionDir: string;
  private sessionFile: string | undefined;
  private persist: boolean;
  private flushed = false;
  private fileEntries: PersistedEntry[] = [];
  private byId: Map<string, Exclude<SessionEntry, SessionHeader>> = new Map();
  private leafId: string | null = null;

  private constructor(channelKey: ChannelKey, sessionDir: string, persist: boolean) {
    this.channelKey = channelKey;
    this.sessionDir = sessionDir;
    this.persist = persist;

    if (persist && sessionDir && !existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }
  }

  static create(channelKey: ChannelKey, sessionDir: string, modelId?: string): SessionManager {
    const manager = new SessionManager(channelKey, sessionDir, true);
    manager.initNewSession(modelId);
    return manager;
  }

  static open(sessionFile: string, channelKey: ChannelKey): SessionManager {
    const dir = resolve(sessionFile, "..");
    const manager = new SessionManager(channelKey, dir, true);
    manager.loadSessionFile(sessionFile);
    return manager;
  }

  static continueRecent(channelKey: ChannelKey, sessionDir: string): SessionManager | null {
    if (!existsSync(sessionDir)) {
      return null;
    }

    const file = findMostRecentSession(sessionDir, channelKey);
    if (!file) {
      return null;
    }

    return SessionManager.open(file, channelKey);
  }

  static restoreOrCreateRecent(
    channelKey: ChannelKey,
    sessionDir: string,
    modelId?: string,
  ): {
    sessionManager: SessionManager;
    status: "restored" | "created";
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

  static inMemory(channelKey: ChannelKey): SessionManager {
    const manager = new SessionManager(channelKey, "", false);
    manager.initNewSession();
    return manager;
  }

  private initNewSession(modelId?: string): void {
    this.sessionId = randomUUID();
    const nowIso = new Date().toISOString();
    const header: SessionHeader = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: this.sessionId,
      channelKey: this.channelKey,
      timestamp: nowIso,
      modelId,
    };

    this.fileEntries = [header];
    this.byId.clear();
    this.leafId = null;
    this.flushed = false;

    if (this.persist) {
      const fileTimestamp = nowIso.replace(/[:.]/g, "-");
      this.sessionFile = join(this.sessionDir, `${fileTimestamp}_${this.sessionId}.jsonl`);
    }
  }

  private loadSessionFile(filePath: string): void {
    this.sessionFile = resolve(filePath);

    if (!existsSync(this.sessionFile)) {
      const explicitPath = this.sessionFile;
      this.initNewSession();
      this.sessionFile = explicitPath;
      return;
    }

    const loaded = loadEntriesFromFile(this.sessionFile);
    if (loaded.length === 0) {
      throw new Error("Invalid session file: empty or malformed JSONL");
    }

    const header = loaded[0];
    if (header.type !== "session") {
      throw new Error("Invalid session file: missing header");
    }

    this.fileEntries = loaded;
    this.sessionId = header.id;
    this.buildIndex();
    this.repairUnresolvedToolCalls();
    this.flushed = true;
  }

  private repairUnresolvedToolCalls(): void {
    const pendingToolCalls = new Map<string, string>();
    const resolvedToolCalls = new Set<string>();

    for (const entry of this.getEntries()) {
      if (entry.type !== "message") {
        continue;
      }

      if ("role" in entry.message && entry.message.role === "assistant") {
        if (typeof entry.message.content === "string") {
          continue;
        }

        for (const part of entry.message.content) {
          if (part.type === "tool-call") {
            pendingToolCalls.set(part.toolCallId, part.toolName);
          }
        }
        continue;
      }

      for (const toolCallId of getToolResultIds(entry.message)) {
        resolvedToolCalls.add(toolCallId);
      }
    }

    for (const [toolCallId, toolName] of pendingToolCalls) {
      if (resolvedToolCalls.has(toolCallId)) {
        continue;
      }

      this.appendToolResultMessage(createInterruptedToolResult(toolCallId, toolName));
    }
  }

  private buildIndex(): void {
    this.byId.clear();
    this.leafId = null;

    for (const entry of this.fileEntries) {
      if (entry.type === "session") {
        continue;
      }

      this.byId.set(entry.id, entry);
      this.leafId = entry.id;
    }
  }

  private appendPersistedEntry(entry: Exclude<SessionEntry, SessionHeader>): void {
    this.fileEntries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this.persistEntry(entry);
  }

  private persistEntry(entry: Exclude<SessionEntry, SessionHeader>): void {
    if (!this.persist || !this.sessionFile) {
      return;
    }

    if (!this.flushed) {
      const dir = resolve(this.sessionFile, "..");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(this.sessionFile, "");
      for (const item of this.fileEntries) {
        appendFileSync(this.sessionFile, `${serializeEntry(item)}\n`);
      }
      this.flushed = true;
      return;
    }

    appendFileSync(this.sessionFile, `${serializeEntry(entry)}\n`);
  }

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
    const header = this.fileEntries[0];
    if (!header || header.type !== "session") {
      throw new Error("Session header missing");
    }

    return header;
  }

  getEntries(): readonly Exclude<SessionEntry, SessionHeader>[] {
    return this.fileEntries.filter(
      (entry): entry is Exclude<SessionEntry, SessionHeader> => entry.type !== "session",
    );
  }

  getSessionMessages(): SessionMessage[] {
    return this.getEntries()
      .filter((entry): entry is SessionMessageEntry => entry.type === "message")
      .map((entry) => entry.message);
  }

  getModelMessages(): ModelMessage[] {
    return convertToLlm(this.getSessionMessages());
  }

  getEntry(id: string): Exclude<SessionEntry, SessionHeader> | undefined {
    return this.byId.get(id);
  }

  getEntryCount(): number {
    return this.byId.size;
  }

  isPersisted(): boolean {
    return this.persist;
  }

  appendSessionMessage(message: SessionMessage): string {
    const entry: SessionMessageEntry = {
      type: "message",
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp:
        "timestamp" in message ? ensureIsoTimestamp(message.timestamp) : new Date().toISOString(),
      message,
    };

    this.appendPersistedEntry(entry);
    return entry.id;
  }

  appendAthenaMessage(message: AthenaMessage): string {
    return this.appendSessionMessage(message);
  }

  appendAssistantMessage(message: AssistantModelMessage): string {
    return this.appendSessionMessage(assistantToSessionMessage(message));
  }

  appendToolResultMessage(message: ToolResultMessage): string {
    return this.appendSessionMessage(toolToSessionMessage(message));
  }

  appendActivationResult(input: {
    id?: string;
    timestamp?: number;
    batchId: string;
    activated: boolean;
    reasons: string[] | ActivationReason[];
  }): string {
    const entry: ActivationResultEntry = {
      type: "activation_result",
      id: input.id ?? generateId(this.byId),
      parentId: this.leafId,
      timestamp: ensureIsoTimestamp(input.timestamp ?? Date.now()),
      batchId: input.batchId,
      activated: input.activated,
      reasons: input.reasons.map((reason) =>
        typeof reason === "string" ? reason : `${reason.source}:${reason.code}`,
      ),
    };

    this.appendPersistedEntry(entry);
    return entry.id;
  }

  appendResponseStatus(input: {
    id?: string;
    timestamp?: number;
    endReason: ResponseStatusReason | string;
    nextAction: string;
    stepsCompleted: number;
    durationMs: number;
    error?: string;
    blockedReason?: string;
  }): string {
    const entry: ResponseStatusEntry = {
      type: "response_status",
      id: input.id ?? generateId(this.byId),
      parentId: this.leafId,
      timestamp: ensureIsoTimestamp(input.timestamp ?? Date.now()),
      endReason: input.endReason,
      nextAction: input.nextAction,
      stepsCompleted: input.stepsCompleted,
      durationMs: input.durationMs,
      error: input.error,
      blockedReason: input.blockedReason,
    };

    this.appendPersistedEntry(entry);
    return entry.id;
  }

  appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number): string {
    const entry: CompactionEntry = {
      type: "compaction",
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      summary,
      firstKeptEntryId,
      tokensBefore,
    };

    this.appendPersistedEntry(entry);
    return entry.id;
  }

  appendSessionInfo(provider: string, modelId: string): string {
    const entry: SessionInfoEntry = {
      type: "session_info",
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      infoType: "model_change",
      provider,
      modelId,
    };

    this.appendPersistedEntry(entry);
    return entry.id;
  }

  appendRuntimeStateInfo(input: {
    stateType: string;
    id?: string;
    timestamp?: number;
    data?: Record<string, import("ai").JSONValue | undefined>;
  }): string {
    const entry: SessionInfoEntry = {
      type: "session_info",
      id: input.id ?? generateId(this.byId),
      parentId: this.leafId,
      timestamp: ensureIsoTimestamp(input.timestamp ?? Date.now()),
      infoType: "runtime_state",
      provider: "runtime",
      modelId: input.stateType,
      stateType: input.stateType,
      data: input.data,
    };

    this.appendPersistedEntry(entry);
    return entry.id;
  }
}

export function extractTextFromResponseMessages(messages: readonly ModelMessage[]): string {
  const textChunks: string[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    if (typeof message.content === "string") {
      textChunks.push(message.content);
      continue;
    }

    for (const part of message.content) {
      if (part.type === "text") {
        textChunks.push(part.text);
      }
    }
  }

  return textChunks.join("");
}

export function athenaMessageToUserModelMessage(message: AthenaMessage): UserModelMessage {
  return {
    role: "user",
    content: message.data.content,
  };
}
