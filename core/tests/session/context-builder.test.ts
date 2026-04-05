import { describe, expect, it } from "vitest";

import {
  buildSessionContext,
  convertAgentMessagesToModelMessages,
  type SessionEntry,
} from "../../src/services/session/session-manager";

describe("buildSessionContext", () => {
  it("projects inbound channel_message to user role", () => {
    const entries: SessionEntry[] = [
      {
        type: "custom_message",
        id: "aaaa1111",
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: "channel_message",
        content: "[alice]: hi",
        display: false,
        details: {
          userId: "alice",
          username: "alice",
          platform: "discord",
          channelId: "channel-1",
          messageId: "msg-1",
          isDirect: true,
          atSelf: false,
          isReplyToBot: false,
        },
      },
    ];

    const ctx = buildSessionContext(entries);
    expect(ctx.agentMessages[0]).toMatchObject({ role: "custom", customType: "channel_message" });

    const modelMessages = convertAgentMessagesToModelMessages(ctx.agentMessages);
    expect(modelMessages[0]).toMatchObject({ role: "user" });
  });

  it("excludes protocol_guidance and other control custom_message from model context", () => {
    const entries: SessionEntry[] = [
      {
        type: "custom_message",
        id: "cccc3333",
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: "protocol_guidance",
        content: "Visible IM replies must be sent with the send_message tool",
        display: false,
      },
      {
        type: "custom_message",
        id: "dddd4444",
        parentId: "cccc3333",
        timestamp: new Date().toISOString(),
        customType: "control_state",
        content: "internal",
        display: false,
      },
    ];

    const ctx = buildSessionContext(entries);
    const modelMessages = convertAgentMessagesToModelMessages(ctx.agentMessages);
    expect(modelMessages).toHaveLength(0);
  });
});
