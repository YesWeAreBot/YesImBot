import type { ModelMessage } from "@ai-sdk/provider-utils";

import { convertToLlm } from "./materialize";
import { SessionManager } from "./session-manager";
import type { ActivationReason, AthenaMessage, SessionEntry, SessionMessage } from "./types/index";
import type {
  AssistantMessageRecord,
  ChannelEventRecord,
  ChannelMessageRecord,
  ChannelRawPayload,
  ResponseStatusRecord,
  ResponseStatusReason,
  StateChangeRecord,
  SystemNoticeRecord,
  TimelineRecord,
  ToolMessageRecord,
} from "./types/index";

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

  getTimeline(): readonly TimelineRecord[] {
    return this.sessionManager.getTimeline();
  }

  getHistory(): readonly TimelineRecord[] {
    return this.getTimeline();
  }

  getInternalRecords(): TimelineRecord[] {
    return this.getTimeline().filter((record) => record.visibility !== "model");
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

  appendAssistantMessage(record: Omit<AssistantMessageRecord, "kind">): string {
    const id = this.sessionManager.appendAssistantMessage(record.message);
    this.refreshCache();
    return id;
  }

  appendToolResultMessage(record: Omit<ToolMessageRecord, "kind">): string {
    const id = this.sessionManager.appendToolResultMessage(record.message);
    this.refreshCache();
    return id;
  }

  appendToolMessage(record: Omit<ToolMessageRecord, "kind">): string {
    return this.appendToolResultMessage(record);
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

  // --------------------------------------------------------------------------
  // Backward compatibility bridge (kept for unaffected callers)
  // --------------------------------------------------------------------------

  appendChannelMessage(record: Omit<ChannelMessageRecord, "kind">): string {
    return this.appendAthenaMessage({
      type: "user.message",
      timestamp: new Date(record.timestamp).toISOString(),
      data: {
        messageId: record.message.messageId,
        senderId: record.message.sender.userId,
        senderName: record.message.sender.nickname ?? record.message.sender.username,
        content: record.message.content,
        replyTo: record.message.replyTo
          ? {
              messageId: record.message.replyTo.messageId,
              senderName: record.message.replyTo.nickname || record.message.replyTo.username,
              content: record.message.replyTo.summary,
            }
          : undefined,
      },
    });
  }

  appendChannelEvent(_record: Omit<ChannelEventRecord, "kind">): string {
    return this.appendAthenaMessage({
      type: "notice.state.update",
      timestamp: new Date().toISOString(),
      data: { content: "[channel-event]" },
    });
  }

  appendStateChange<TData extends ChannelRawPayload | undefined = undefined>(
    record: Omit<StateChangeRecord<TData>, "kind">,
  ): string {
    if (record.stateType === "response_status") {
      const status = (record.data ?? {}) as {
        endReason?: ResponseStatusReason;
        nextAction?: string;
        stepsCompleted?: number;
        durationMs?: number;
      };

      const id = this.sessionManager.appendResponseStatus({
        id: record.id,
        timestamp: record.timestamp,
        endReason: status.endReason ?? "exception",
        nextAction: status.nextAction ?? "blocked",
        stepsCompleted: status.stepsCompleted ?? 0,
        durationMs: status.durationMs ?? 0,
      });
      this.refreshCache();
      return id;
    }

    const id = this.sessionManager.appendRuntimeStateInfo(
      {
        stateType: record.stateType,
        id: record.id,
        timestamp: record.timestamp,
        data: (record.data ?? undefined) as Record<string, import("ai").JSONValue | undefined> | undefined,
      },
    );
    this.refreshCache();
    return id;
  }

  appendSystemNotice<TData extends ChannelRawPayload | undefined = undefined>(
    record: Omit<SystemNoticeRecord<TData>, "kind">,
  ): string {
    if (record.materializationKey === "activation_result") {
      const payload = (record.data ?? {}) as {
        batchId?: string;
        activated?: boolean;
        reasons?: string[];
      };
      const id = this.sessionManager.appendActivationResult({
        id: record.id,
        timestamp: record.timestamp,
        batchId: payload.batchId ?? "unknown-batch",
        activated: payload.activated ?? false,
        reasons: payload.reasons ?? [],
      });
      this.refreshCache();
      return id;
    }

    if (record.materializationKey === "response_status") {
      const payload = (record.data ?? {}) as {
        endReason?: ResponseStatusReason;
        nextAction?: string;
        stepsCompleted?: number;
        durationMs?: number;
      };
      const id = this.sessionManager.appendResponseStatus({
        id: record.id,
        timestamp: record.timestamp,
        endReason:
          payload.endReason ?? (record.subType.replace(/^response_status_/, "") || "exception"),
        nextAction: payload.nextAction ?? "blocked",
        stepsCompleted: payload.stepsCompleted ?? 0,
        durationMs: payload.durationMs ?? 0,
      });
      this.refreshCache();
      return id;
    }

    const id = this.sessionManager.appendAthenaMessage({
      type: "notice.state.update",
      timestamp: new Date(record.timestamp).toISOString(),
      data: { content: record.notice },
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
