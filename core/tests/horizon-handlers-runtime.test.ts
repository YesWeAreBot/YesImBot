import { describe, expect, it } from "vitest";

import { AgentActionHandler, AgentResponseHandler } from "../src/services/horizon/handlers";
import { TimelineEventType } from "../src/services/horizon/types";
import { createAgentActionRecord, createAgentResponseRecord } from "./fixtures/timeline-entries";

describe("horizon handler regressions", () => {
  it("AgentResponseHandler only handles agent.response entries", () => {
    const responseHandler = new AgentResponseHandler();
    const responseEntry = createAgentResponseRecord({
      index: 51,
      minutesOffset: 1,
      data: { rawText: "ok" },
    });
    const actionEntry = createAgentActionRecord({
      index: 51,
      minutesOffset: 2,
      data: {
        actions: [{ name: "send_message", params: { content: "hello" } }],
        toolResults: [{ name: "send_message", success: true, status: "ok" }],
      },
    });

    expect(responseHandler.canHandle(responseEntry)).toBe(true);
    expect(responseEntry.type).toBe(TimelineEventType.AgentResponse);
    expect(responseHandler.canHandle(actionEntry)).toBe(false);
  });

  it("AgentActionHandler renders action params and send_message result previews", async () => {
    const actionHandler = new AgentActionHandler();
    const actionEntry = createAgentActionRecord({
      index: 52,
      minutesOffset: 1,
      data: {
        actions: [{ name: "send_message", params: { content: "hello", replyTo: "7" } }],
        toolResults: [
          {
            name: "send_message",
            success: true,
            status: "sent",
            result: { messageId: "sent-52", content: "hello" },
          },
        ],
      },
    });

    const messages = await actionHandler.handle(actionEntry, {});
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toContain('send_message({"content":"hello","replyTo":"7"})');
    expect(messages[0]?.content).toContain("send_message -> sent");
  });
});
