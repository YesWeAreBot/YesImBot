import type { ModelMessage } from "@ai-sdk/provider-utils";

import { convertToLlm } from "./materialize";
import type {
  ActivationReason,
  AthenaMessage,
  ResponseStatusRecord,
  SessionEntry,
  SessionMessage,
} from "./messages";
import { SessionManager } from "./session-manager";

export class AgentSession {
  readonly sessionManager: SessionManager;

  private entries: SessionEntry[];
  private sessionMessages: SessionMessage[];

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.entries = [...sessionManager.getEntries()];
    this.sessionMessages = [...sessionManager.getSessionMessages()];
  }

  getEntries(): readonly SessionEntry[] {
    return [...this.entries];
  }

  getSessionMessages(): readonly SessionMessage[] {
    return [...this.sessionMessages];
  }

  getModelMessages(): ModelMessage[] {
    const latestCompaction = this.findLatestCompaction();
    const scopedMessages = latestCompaction
      ? this.sliceMessagesFromEntry(latestCompaction.firstKeptEntryId)
      : [...this.sessionMessages];

    const modelMessages = convertToLlm(scopedMessages);
    if (!latestCompaction) {
      return modelMessages;
    }

    return [
      {
        role: "user",
        content: `[Context Summary]\n${latestCompaction.summary}`,
      },
      ...modelMessages,
    ];
  }

  appendSessionMessage(message: SessionMessage): string {
    const id = this.sessionManager.appendSessionMessage(message);
    this.refreshCache();
    return id;
  }

  appendAthenaMessage(message: AthenaMessage): string {
    const id = this.sessionManager.appendAthenaMessage(message);
    this.refreshCache();
    return id;
  }

  appendAssistantMessage(message: Extract<SessionMessage, { role: "assistant" }>): string {
    const id = this.sessionManager.appendAssistantMessage(message);
    this.refreshCache();
    return id;
  }

  appendToolResultMessage(message: Extract<SessionMessage, { role: "tool" }>): string {
    const id = this.sessionManager.appendToolResultMessage(message);
    this.refreshCache();
    return id;
  }

  appendToolMessage(message: Extract<SessionMessage, { role: "tool" }>): string {
    return this.appendToolResultMessage(message);
  }

  appendActivationResult(record: {
    id: string;
    timestamp: number;
    stage: "ingress" | "runtime" | "persisted";
    batchId: string;
    activated: boolean;
    reasons: ActivationReason[];
  }): string {
    void record.stage;
    const id = this.sessionManager.appendActivationResult({
      id: record.id,
      timestamp: record.timestamp,
      batchId: record.batchId,
      activated: record.activated,
      reasons: record.reasons,
    });
    this.refreshCache();
    return id;
  }

  appendResponseStatus(record: ResponseStatusRecord): string {
    const id = this.sessionManager.appendResponseStatus({
      timestamp: Date.now(),
      endReason: record.endReason,
      nextAction: record.nextAction,
      stepsCompleted: record.stepsCompleted,
      durationMs: record.durationMs,
      error: record.error,
      blockedReason: record.blockedReason,
    });
    this.refreshCache();
    return id;
  }

  appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number): string {
    const id = this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore);
    this.refreshCache();
    return id;
  }

  appendSessionInfo(provider: string, modelId: string): string {
    const id = this.sessionManager.appendSessionInfo(provider, modelId);
    this.refreshCache();
    return id;
  }

  appendRuntimeStateInfo(
    stateType: string,
    options?: {
      id?: string;
      timestamp?: number;
    },
    data?: Record<string, import("ai").JSONValue | undefined>,
  ): string {
    const id = this.sessionManager.appendRuntimeStateInfo({
      stateType,
      id: options?.id,
      timestamp: options?.timestamp,
      data,
    });
    this.refreshCache();
    return id;
  }

  private refreshCache(): void {
    this.entries = [...this.sessionManager.getEntries()];
    this.sessionMessages = [...this.sessionManager.getSessionMessages()];
  }

  private findLatestCompaction(): { summary: string; firstKeptEntryId: string } | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry?.type === "compaction") {
        return {
          summary: entry.summary,
          firstKeptEntryId: entry.firstKeptEntryId,
        };
      }
    }

    return undefined;
  }

  private sliceMessagesFromEntry(firstKeptEntryId: string): SessionMessage[] {
    const idx = this.entries.findIndex((entry) => entry.id === firstKeptEntryId);
    if (idx < 0) {
      return [...this.sessionMessages];
    }

    return this.entries
      .slice(idx)
      .filter(
        (entry): entry is Extract<SessionEntry, { type: "message" }> => entry.type === "message",
      )
      .map((entry) => entry.message);
  }
}
