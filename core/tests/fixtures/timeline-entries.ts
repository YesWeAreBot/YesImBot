import type {
  AgentActionData,
  AgentActionRecord,
  AgentResponseData,
  AgentResponseRecord,
  HeartbeatData,
  HeartbeatRecord,
  MessageEventData,
  MessageRecord,
  SummaryData,
  SummaryRecord,
  TimelineEntry,
} from "../../src/services/horizon/types";
import {
  TimelineEventType,
  TimelinePriority,
  TimelineStage,
} from "../../src/services/horizon/types";

/**
 * Base timestamp for deterministic test fixtures
 * All timestamps increment from this base
 */
const BASE_TIMESTAMP = new Date("2026-03-05T10:00:00Z");

/**
 * Generate deterministic timestamp by adding minutes to base
 */
function timestamp(minutesOffset: number = 0): Date {
  return new Date(BASE_TIMESTAMP.getTime() + minutesOffset * 60000);
}

/**
 * Generate deterministic ID
 */
function generateId(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(8, "0")}`;
}

/**
 * Create MessageRecord with sensible defaults
 */
export function createMessageRecord(
  overrides: Partial<MessageRecord> & { index?: number; minutesOffset?: number } = {},
): MessageRecord {
  const index = overrides.index ?? 1;
  const minutesOffset = overrides.minutesOffset ?? 0;

  return {
    id: generateId("msg", index),
    timestamp: timestamp(minutesOffset),
    platform: "test-platform",
    channelId: "test-channel",
    type: TimelineEventType.Message,
    priority: TimelinePriority.Normal,
    stage: TimelineStage.Active,
    data: {
      messageId: generateId("native-msg", index),
      senderId: "user-001",
      senderName: "TestUser",
      content: "Test message content",
      ...overrides.data,
    },
    ...overrides,
  };
}

/**
 * Create MessageRecord with image elements in content
 */
export function createImageMessageRecord(
  imageIds: string[],
  overrides: Partial<MessageRecord> & { index?: number; minutesOffset?: number } = {},
): MessageRecord {
  const imageTags = imageIds.map((id) => `<img id="${id}"/>`).join(" ");
  const content = `Message with images: ${imageTags}`;

  return createMessageRecord({
    ...overrides,
    data: {
      ...overrides.data,
      content,
    },
  });
}

/**
 * Create SummaryRecord with sensible defaults
 */
export function createSummaryRecord(
  overrides: Partial<SummaryRecord> & { index?: number; minutesOffset?: number } = {},
): SummaryRecord {
  const index = overrides.index ?? 1;
  const minutesOffset = overrides.minutesOffset ?? 0;

  return {
    id: generateId("summary", index),
    timestamp: timestamp(minutesOffset),
    platform: "test-platform",
    channelId: "test-channel",
    type: TimelineEventType.Summary,
    priority: TimelinePriority.Core,
    stage: TimelineStage.Active,
    data: {
      content: "Test summary content",
      coveredUntil: timestamp(minutesOffset - 10),
      ...overrides.data,
    },
    ...overrides,
  };
}

/**
 * Create AgentResponseRecord with sensible defaults
 */
export function createAgentResponseRecord(
  overrides: Partial<AgentResponseRecord> & { index?: number; minutesOffset?: number } = {},
): AgentResponseRecord {
  const index = overrides.index ?? 1;
  const minutesOffset = overrides.minutesOffset ?? 0;

  return {
    id: generateId("response", index),
    timestamp: timestamp(minutesOffset),
    platform: "test-platform",
    channelId: "test-channel",
    type: TimelineEventType.AgentResponse,
    priority: TimelinePriority.Normal,
    stage: TimelineStage.Active,
    data: {
      rawText: "Test agent response",
      ...overrides.data,
    },
    ...overrides,
  };
}

/**
 * Create AgentActionRecord with sensible defaults
 */
export function createAgentActionRecord(
  overrides: Partial<AgentActionRecord> & { index?: number; minutesOffset?: number } = {},
): AgentActionRecord {
  const index = overrides.index ?? 1;
  const minutesOffset = overrides.minutesOffset ?? 0;

  return {
    id: generateId("action", index),
    timestamp: timestamp(minutesOffset),
    platform: "test-platform",
    channelId: "test-channel",
    type: TimelineEventType.AgentAction,
    priority: TimelinePriority.Normal,
    stage: TimelineStage.Active,
    data: {
      actions: [{ name: "test_action", params: { key: "value" } }],
      toolResults: [{ name: "test_action", success: true, result: "success" }],
      ...overrides.data,
    },
    ...overrides,
  };
}

/**
 * Create HeartbeatRecord with sensible defaults
 */
export function createHeartbeatRecord(
  overrides: Partial<HeartbeatRecord> & { index?: number; minutesOffset?: number } = {},
): HeartbeatRecord {
  const index = overrides.index ?? 1;
  const minutesOffset = overrides.minutesOffset ?? 0;

  return {
    id: generateId("heartbeat", index),
    timestamp: timestamp(minutesOffset),
    platform: "test-platform",
    channelId: "test-channel",
    type: TimelineEventType.Heartbeat,
    priority: TimelinePriority.Noise,
    stage: TimelineStage.Active,
    data: {
      triggeredBy: "manual",
      channelSummary: "heartbeat",
      ...overrides.data,
    },
    ...overrides,
  };
}

/**
 * Create a sequence of Timeline entries with incrementing timestamps
 */
export function createTimelineSequence(
  count: number,
  factory: (index: number) => TimelineEntry,
): TimelineEntry[] {
  return Array.from({ length: count }, (_, i) => factory(i + 1));
}

/**
 * Create a mixed Timeline with messages, responses, and summaries
 */
export function createMixedTimeline(config: {
  messages?: number;
  responses?: number;
  summaries?: number;
  actions?: number;
}): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let offset = 0;

  for (let i = 0; i < (config.messages ?? 0); i++) {
    entries.push(createMessageRecord({ index: i + 1, minutesOffset: offset++ }));
  }

  for (let i = 0; i < (config.responses ?? 0); i++) {
    entries.push(createAgentResponseRecord({ index: i + 1, minutesOffset: offset++ }));
  }

  for (let i = 0; i < (config.summaries ?? 0); i++) {
    entries.push(createSummaryRecord({ index: i + 1, minutesOffset: offset++ }));
  }

  for (let i = 0; i < (config.actions ?? 0); i++) {
    entries.push(createAgentActionRecord({ index: i + 1, minutesOffset: offset++ }));
  }

  return entries;
}
