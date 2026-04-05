import type { ModelMessage } from "@ai-sdk/provider-utils";

import type {
  AssistantMessageRecord,
  CanonicalRawPayload,
  ChannelEventRecord,
  ChannelMessageRecord,
  StateChangeRecord,
  SystemNoticeRecord,
  TimelineRecord,
  ToolMessageRecord,
} from "./contracts";
import { materializeTimeline } from "./materialize";
import { SessionManager } from "./session-manager";

export class AgentSession {
  readonly sessionManager: SessionManager;

  private timeline: TimelineRecord[];

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.timeline = [...sessionManager.getTimeline()];
  }

  getTimeline(): readonly TimelineRecord[] {
    return [...this.timeline];
  }

  getHistory(): readonly TimelineRecord[] {
    return this.getTimeline();
  }

  getModelMessages(): ModelMessage[] {
    const entries = this.sessionManager.getEntries();
    let latestCompaction:
      | {
          summary: string;
          firstKeptEntryId: string;
        }
      | undefined;

    for (const entry of entries) {
      if (entry.type !== "compaction") {
        continue;
      }

      latestCompaction = {
        summary: entry.summary,
        firstKeptEntryId: entry.firstKeptEntryId,
      };
    }

    const timeline = latestCompaction
      ? this.timeline.slice(
          Math.max(
            0,
            this.timeline.findIndex((record) => record.id === latestCompaction.firstKeptEntryId),
          ),
        )
      : this.timeline;
    const messages = materializeTimeline(timeline);

    if (!latestCompaction) {
      return messages;
    }

    return [{ role: "user", content: `[Context Summary]\n${latestCompaction.summary}` }, ...messages];
  }

  getInternalRecords(): TimelineRecord[] {
    return this.timeline.filter((record) => record.visibility !== "model");
  }

  appendChannelMessage(record: Omit<ChannelMessageRecord, "kind">): string {
    const normalizedRecord: ChannelMessageRecord = {
      ...record,
      kind: "channel_message",
    };
    this.timeline.push(normalizedRecord);
    this.sessionManager.appendTimelineRecord(normalizedRecord);
    return normalizedRecord.id;
  }

  appendChannelEvent(record: Omit<ChannelEventRecord, "kind">): string {
    const normalizedRecord: ChannelEventRecord = {
      ...record,
      kind: "channel_event",
    };
    this.timeline.push(normalizedRecord);
    this.sessionManager.appendTimelineRecord(normalizedRecord);
    return normalizedRecord.id;
  }

  appendStateChange<TData extends CanonicalRawPayload | undefined = undefined>(
    record: Omit<StateChangeRecord<TData>, "kind">,
  ): string {
    const normalizedRecord: StateChangeRecord<TData> = {
      ...record,
      kind: "state_change",
    };
    this.timeline.push(normalizedRecord);
    this.sessionManager.appendTimelineRecord(normalizedRecord);
    return normalizedRecord.id;
  }

  appendSystemNotice<TData extends CanonicalRawPayload | undefined = undefined>(
    record: Omit<SystemNoticeRecord<TData>, "kind">,
  ): string {
    const normalizedRecord: SystemNoticeRecord<TData> = {
      ...record,
      kind: "system_notice",
    };
    this.timeline.push(normalizedRecord);
    this.sessionManager.appendTimelineRecord(normalizedRecord);
    return normalizedRecord.id;
  }

  appendAssistantMessage(record: Omit<AssistantMessageRecord, "kind">): string {
    const normalizedRecord: AssistantMessageRecord = {
      ...record,
      kind: "assistant_message",
    };
    this.timeline.push(normalizedRecord);
    this.sessionManager.appendTimelineRecord(normalizedRecord);
    return normalizedRecord.id;
  }

  appendToolMessage(record: Omit<ToolMessageRecord, "kind">): string {
    const normalizedRecord: ToolMessageRecord = {
      ...record,
      kind: "tool_message",
    };
    this.timeline.push(normalizedRecord);
    this.sessionManager.appendTimelineRecord(normalizedRecord);
    return normalizedRecord.id;
  }
}
