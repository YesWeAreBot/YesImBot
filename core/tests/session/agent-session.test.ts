import { describe, expect, it } from "vitest";

import type {
  AssistantMessageRecord,
  ChannelEventRecord,
  ChannelMessageRecord,
  StateChangeRecord,
  SystemNoticeRecord,
  ToolMessageRecord,
} from "../../src/services/session/contracts";
import { AgentSession } from "../../src/services/session/agent-session";
import { SessionManager } from "../../src/services/session/session-manager";
import type { ChannelKey } from "../../src/services/session/types";

const channelKey: ChannelKey = "discord:channel-1";

function createSessionManager(): SessionManager {
  return SessionManager.inMemory(channelKey);
}

describe("AgentSession", () => {
  it("exposes layered views for timeline, model messages, and internal records", () => {
    const session = new AgentSession(createSessionManager());

    session.appendChannelMessage({
      id: "message-1",
      timestamp: 100,
      stage: "ingress",
      visibility: "model",
      materialization: "default",
      message: {
        kind: "channel_message",
        platform: "discord",
        channelId: "channel-1",
        messageId: "msg-1",
        timestamp: 100,
        content: "hello",
        sender: {
          userId: "user-1",
          username: "alice",
          nickname: "Alice",
        },
        isDirect: true,
        atSelf: false,
        isReplyToBot: false,
      },
    });
    session.appendStateChange({
      id: "state-1",
      timestamp: 101,
      stage: "runtime",
      visibility: "internal",
      materialization: "internal",
      stateType: "response_state",
      data: { status: "idle" },
    });

    const timeline = session.getTimeline();
    const modelMessages = session.getModelMessages();
    const internalRecords = session.getInternalRecords();

    expect(timeline).toHaveLength(2);
    expect(modelMessages).toHaveLength(1);
    expect(modelMessages[0]).toMatchObject({ role: "user" });
    expect(internalRecords).toHaveLength(1);
    expect(internalRecords[0]).toMatchObject({ kind: "state_change" });
  });

  it("advances session state only through explicit append APIs", () => {
    const sessionManager = createSessionManager();
    const session = new AgentSession(sessionManager);

    session.appendChannelEvent({
      id: "event-1",
      timestamp: 102,
      stage: "ingress",
      visibility: "internal",
      materialization: "internal",
      event: {
        kind: "channel_event",
        platform: "discord",
        channelId: "channel-1",
        eventId: "evt-1",
        eventType: "reaction_added",
        timestamp: 102,
        sourceUserId: "user-1",
      },
    });

    expect(session.getTimeline()).toHaveLength(1);
    expect(sessionManager.getEntries()).toHaveLength(1);
  });

  it("writes assistant/tool durable truth as first-class timeline records", () => {
    const session = new AgentSession(createSessionManager());

    session.appendAssistantMessage({
      id: "assistant-1",
      timestamp: 103,
      stage: "runtime",
      visibility: "model",
      materialization: "default",
      message: {
        role: "assistant",
        content: "done",
      },
    });
    session.appendToolMessage({
      id: "tool-1",
      timestamp: 104,
      stage: "runtime",
      visibility: "model",
      materialization: "default",
      message: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "lookupWeather",
            output: { value: 21 },
          },
        ],
      },
    });

    const timeline = session.getTimeline();

    expect(timeline[0]).toMatchObject({ kind: "assistant_message" });
    expect(timeline[1]).toMatchObject({ kind: "tool_message" });
    expect(timeline[0]).not.toHaveProperty("role");
    expect(timeline[1]).not.toHaveProperty("customType");
  });

  it("keeps SystemNotice internal unless explicitly requested", () => {
    const session = new AgentSession(createSessionManager());

    session.appendSystemNotice({
      id: "notice-1",
      timestamp: 105,
      stage: "runtime",
      visibility: "hidden",
      materialization: "subtype",
      subType: "compaction_summary",
      materializationKey: "compaction-summary",
      notice: "compaction ready",
    });

    expect(session.getModelMessages()).toEqual([]);
    expect(session.getInternalRecords()).toEqual([
      expect.objectContaining({ kind: "system_notice", subType: "compaction_summary" }),
    ]);
  });
});

void ({} as {
  layeredViews: ChannelMessageRecord;
  append: ChannelEventRecord;
  assistantTool: AssistantMessageRecord | ToolMessageRecord;
  SystemNotice: SystemNoticeRecord;
  internal: StateChangeRecord;
});
