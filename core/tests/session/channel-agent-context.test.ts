import { describe, expect, it } from "vitest";

import { buildGenerateInputForTest } from "../../src/services/session/runtime";

describe("ChannelRuntime runResponse", () => {
  it("passes converted model messages to ToolLoopAgent.generate while retaining custom messages in session context", () => {
    const generateInput = buildGenerateInputForTest({
      instructions: "You are helpful.",
      sessionEntries: [
        {
          type: "custom_message",
          id: "aaaa1111",
          parentId: null,
          timestamp: new Date().toISOString(),
          customType: "channel_message",
          content: "[alice]: hi",
          display: false,
        },
      ],
    });

    expect(generateInput.messages[0]).toMatchObject({ role: "system" });
    expect(generateInput.messages[1]).toMatchObject({ role: "user" });
  });
});

describe("context safety net", () => {
  it("does not project protocol_guidance into normal rebuilt model context", () => {
    const generateInput = buildGenerateInputForTest({
      instructions: "You are helpful.",
      sessionEntries: [
        {
          type: "custom_message",
          id: "proto-1",
          parentId: null,
          timestamp: new Date().toISOString(),
          customType: "protocol_guidance",
          content: "Visible IM replies must be sent with send_message",
          display: false,
        },
      ],
    });

    expect(generateInput.messages).toHaveLength(1);
    expect(generateInput.messages[0]).toMatchObject({ role: "system" });
  });

  it("hard truncation when token count exceeds limit", () => {
    const longChunk = "x".repeat(1000);
    const sessionEntries = Array.from({ length: 500 }, (_, index) => ({
      type: "custom_message" as const,
      id: `msg-${index}`,
      parentId: null,
      timestamp: new Date(Date.now() + index).toISOString(),
      customType: "channel_message",
      content: `[user-${index}]: ${longChunk}`,
      display: false,
    }));

    const generateInput = buildGenerateInputForTest({
      instructions: "You are helpful.",
      sessionEntries,
    });

    const totalChars = JSON.stringify(generateInput.messages).length;
    expect(totalChars).toBeGreaterThan(100000);
  });
});
