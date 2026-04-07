import type { ModelMessage, SystemModelMessage, UserModelMessage } from "@ai-sdk/provider-utils";

import { formatCanonicalChannelMessage } from "./channel-message";
import type {
  CanonicalRawPayload,
  ChannelEventRecord,
  ChannelMessageRecord,
  StateChangeRecord,
  SystemNoticeRecord,
  TimelineRecord,
} from "./contracts";

export interface MaterializeTimelineOptions {
  includeInternal?: boolean;
  systemNoticeStrategies?: Partial<Record<string, SystemNoticeStrategy>>;
}

export type SystemNoticeStrategy = (
  record: SystemNoticeRecord<CanonicalRawPayload | undefined>,
) => ModelMessage | ModelMessage[] | null | undefined;

export function materializeTimelineRecord(
  record: TimelineRecord,
  options: MaterializeTimelineOptions = {},
): ModelMessage[] {
  switch (record.kind) {
    case "channel_message":
      return shouldProjectRecord(record, options) ? [materializeChannelMessage(record)] : [];
    case "channel_event":
      return shouldProjectRecord(record, options) ? [materializeChannelEvent(record)] : [];
    case "assistant_message":
      return shouldProjectRecord(record, options) ? [record.message] : [];
    case "tool_message":
      return shouldProjectRecord(record, options) ? [record.message] : [];
    case "state_change":
      return shouldProjectRecord(record, options) ? [materializeStateChange(record)] : [];
    case "system_notice": {
      const strategy = options.systemNoticeStrategies?.[record.subType];
      if (!strategy) {
        return [];
      }

      const result = strategy(record);
      if (!result) {
        return [];
      }

      return Array.isArray(result) ? result : [result];
    }
  }
}

export function materializeTimeline(
  records: TimelineRecord[],
  options: MaterializeTimelineOptions = {},
): ModelMessage[] {
  return records.flatMap((record) => materializeTimelineRecord(record, options));
}

function shouldProjectRecord(record: TimelineRecord, options: MaterializeTimelineOptions): boolean {
  if (record.materialization === "hidden" || record.visibility === "hidden") {
    return false;
  }

  if (
    (record.materialization === "internal" || record.visibility === "internal") &&
    options.includeInternal !== true
  ) {
    return false;
  }

  return true;
}

function materializeChannelMessage(record: ChannelMessageRecord): UserModelMessage {
  return {
    role: "user",
    content: formatCanonicalChannelMessage(record.message),
  };
}

function materializeChannelEvent(record: ChannelEventRecord): SystemModelMessage {
  const { event } = record;

  return {
    role: "system",
    content: `[channel-event] type=${event.eventType} platform=${event.platform} channel=${event.channelId} sourceUserId=${event.sourceUserId ?? "unknown"}`,
  };
}

function materializeStateChange(
  record: StateChangeRecord<CanonicalRawPayload | undefined>,
): SystemModelMessage {
  return {
    role: "system",
    content: `[state-change] type=${record.stateType} data=${JSON.stringify(record.data ?? {})}`,
  };
}
