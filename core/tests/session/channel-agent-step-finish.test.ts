import { describe, expect, it } from "vitest";

import { createAgentAssistantMessage } from "../../src/services/session/channel-agent";
import { extractMessages } from "../../src/services/session/channel-agent/output";

describe("ChannelAgent handleStepFinish", () => {
  it("normalizes assistant reasoning blocks and usage metadata into AgentMessage payloads", () => {
    const persisted = createAgentAssistantMessage({
      content: [
        { type: "reasoning", text: "considering options" },
        { type: "text", text: "final answer" },
      ],
      usage: { inputTokens: 10, outputTokens: 5, cacheRead: 7, cacheWrite: 3 },
      finishReason: "stop",
    });

    expect(persisted).toMatchObject({
      role: "assistant",
      content: [
        { type: "thinking", text: "considering options" },
        { type: "text", text: "final answer" },
      ],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheRead: 7, cacheWrite: 3 },
      finishReason: "stop",
    });
  });

  it("drops placeholder zero usage records", () => {
    const persisted = createAgentAssistantMessage({
      content: [{ type: "text", text: "final answer" }],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0 },
      finishReason: "stop",
    });

    expect(persisted.usage).toBeUndefined();
  });

  describe("output extraction", () => {
    it("extracts message-tagged content only", () => {
      const text = "thinking...\n<message>Hello world</message>\nmore thinking";
      const result = extractMessages(text);
      expect(result).toEqual(["Hello world"]);
    });

    it("splits on sep tags", () => {
      const text = "<message>Part 1<sep/>Part 2</message>";
      const result = extractMessages(text);
      expect(result).toEqual(["Part 1", "Part 2"]);
    });

    it("returns empty array when no message tags", () => {
      const text = "Just thinking, no output";
      const result = extractMessages(text);
      expect(result).toEqual([]);
    });

    it("preserves Koishi elements inside message tags", () => {
      const text = '<message>Hey <at id="123"/> check this</message>';
      const result = extractMessages(text);
      expect(result).toEqual(['Hey <at id="123"/> check this']);
    });

    it("handles multiple message blocks", () => {
      const text = "<message>First</message>thinking<message>Second</message>";
      const result = extractMessages(text);
      expect(result).toEqual(["First", "Second"]);
    });
  });
});
