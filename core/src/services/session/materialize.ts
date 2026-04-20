import type { ModelMessage, SystemModelMessage, UserModelMessage } from "@ai-sdk/provider-utils";

import { formatChannelMessageInput } from "./channel-message";
import type { AthenaMessage } from "./domain/athena-message";
import type { SessionMessage } from "./domain/session-message";
import type {
  ChannelRawPayload,
  ChannelEventRecord,
  ChannelMessageRecord,
  StateChangeRecord,
  SystemNoticeRecord,
  TimelineRecord,
} from "./types/index";

export interface CompactionMaterializeOptions {
  includeInternal?: boolean;
  systemNoticeStrategies?: Partial<Record<string, SystemNoticeStrategy>>;
}

export type SystemNoticeStrategy = (
  record: SystemNoticeRecord<ChannelRawPayload | undefined>,
) => ModelMessage | ModelMessage[] | null | undefined;

export function materializeTimelineForCompactionRecord(
  record: TimelineRecord,
  options: CompactionMaterializeOptions = {},
): ModelMessage[] {
  switch (record.kind) {
    case "athena_event":
      // Phase 12+ provider context is SessionMessage[]-only.
      // Legacy athena_event timeline rows are never projected here.
      return [];
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

export function materializeTimelineForCompaction(
  records: TimelineRecord[],
  options: CompactionMaterializeOptions = {},
): ModelMessage[] {
  return records.flatMap((record) => materializeTimelineForCompactionRecord(record, options));
}

export function convertToLlm(messages: SessionMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if ("role" in message) {
      switch (message.role) {
        case "assistant":
        case "tool":
          return message;
        default: {
          const exhaustiveCheck: never = message;
          throw new Error(`Unsupported SessionMessage role: ${String(exhaustiveCheck)}`);
        }
      }
    }

    return athenaMessageToUserModelMessage(message);
  });
}

function athenaMessageToUserModelMessage(message: AthenaMessage): UserModelMessage {
  switch (message.type) {
    case "user.message":
    case "notice.member.join":
    case "notice.member.leave":
    case "notice.reaction":
    case "notice.state.update":
      return {
        role: "user",
        content: message.data.content,
      } satisfies UserModelMessage;
    default: {
      const exhaustiveCheck: never = message;
      throw new Error(`Unsupported AthenaMessage type: ${String(exhaustiveCheck)}`);
    }
  }
}

function shouldProjectRecord(record: TimelineRecord, options: CompactionMaterializeOptions): boolean {
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

function materializeChannelMessage(
  record: ChannelMessageRecord<ChannelRawPayload | undefined>,
): UserModelMessage {
  return {
    role: "user",
    content: formatChannelMessageInput(record.message),
  };
}

function materializeChannelEvent(
  record: ChannelEventRecord<ChannelRawPayload | undefined>,
): SystemModelMessage {
  const { event } = record;

  return {
    role: "system",
    content: `[channel-event] type=${event.eventType} platform=${event.platform} channel=${event.channelId} sourceUserId=${event.sourceUserId ?? "unknown"}`,
  };
}

function materializeStateChange(
  record: StateChangeRecord<ChannelRawPayload | undefined>,
): SystemModelMessage {
  return {
    role: "system",
    content: `[state-change] type=${record.stateType} data=${JSON.stringify(record.data ?? {})}`,
  };
}
