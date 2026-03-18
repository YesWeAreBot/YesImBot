import { describe, expect, it } from "vitest";

import type { LoopMessage } from "../src/services/agent/trimmer";
import { totalChars, trimMessages, type TrimConfig } from "../src/services/agent/trimmer";

/**
 * Helper to create a LoopMessage with string content
 */
function createMessage(role: "user" | "assistant", content: string): LoopMessage {
  return { role, content };
}

/**
 * Helper to create a LoopMessage with UserContent (multimodal)
 */
function createMultimodalMessage(role: "user" | "assistant", text: string): LoopMessage {
  return {
    role,
    content: [
      { type: "text", text },
      { type: "image", image: "base64data" },
    ],
  };
}

/**
 * Default trim config for tests
 */
const defaultConfig: TrimConfig = {
  charBudget: 1000,
  keepLastRounds: 2,
  softTrimHead: 50,
  softTrimTail: 50,
  initialContextCharBudget: 500,
};

describe("trimMessages - Edge Cases", () => {
  describe("Consecutive user messages", () => {
    it("handles consecutive user messages without crashing", () => {
      const messages: LoopMessage[] = [
        createMessage("user", "First message"),
        createMessage("user", "Second message"),
        createMessage("user", "Third message"),
        createMessage("assistant", "Response"),
      ];

      expect(() => trimMessages(messages, defaultConfig)).not.toThrow();
    });

    it("treats consecutive user messages as single round", () => {
      const messages: LoopMessage[] = [
        createMessage("user", "A".repeat(200)),
        createMessage("user", "B".repeat(200)),
        createMessage("assistant", "C".repeat(200)),
        createMessage("user", "D".repeat(200)),
        createMessage("assistant", "E".repeat(200)),
      ];

      const config: TrimConfig = {
        ...defaultConfig,
        charBudget: 400,
        keepLastRounds: 1, // Protect last round only
      };

      trimMessages(messages, config);

      // Last round (D + E) should be protected
      expect(messages[3].content).toBe("D".repeat(200));
      expect(messages[4].content).toBe("E".repeat(200));

      // First round (A + B + C) should be trimmed
      // Note: protected rounds may exceed budget, so we just verify first round was trimmed
      const firstRoundChars =
        (messages[0].content as string).length +
        (messages[1].content as string).length +
        (messages[2].content as string).length;
      expect(firstRoundChars).toBeLessThan(600); // Original was 600 chars
    });
  });

  describe("Multiple assistant responses", () => {
    it("handles multiple assistant messages in one round", () => {
      const messages: LoopMessage[] = [
        createMessage("user", "Question"),
        createMessage("assistant", "First response"),
        createMessage("assistant", "Second response"),
        createMessage("user", "Follow-up"),
        createMessage("assistant", "Final response"),
      ];

      expect(() => trimMessages(messages, defaultConfig)).not.toThrow();
    });

    it("protects all messages in protected rounds", () => {
      const messages: LoopMessage[] = [
        createMessage("user", "A".repeat(200)),
        createMessage("assistant", "B".repeat(200)),
        createMessage("assistant", "C".repeat(200)),
        createMessage("user", "D".repeat(200)),
        createMessage("assistant", "E".repeat(200)),
      ];

      const config: TrimConfig = {
        ...defaultConfig,
        charBudget: 400,
        keepLastRounds: 1,
      };

      trimMessages(messages, config);

      // Last round (D + E) protected
      expect(messages[3].content).toBe("D".repeat(200));
      expect(messages[4].content).toBe("E".repeat(200));
    });
  });

  describe("All user messages", () => {
    it("handles array with only user messages", () => {
      const messages: LoopMessage[] = [
        createMessage("user", "Message 1"),
        createMessage("user", "Message 2"),
        createMessage("user", "Message 3"),
      ];

      expect(() => trimMessages(messages, defaultConfig)).not.toThrow();
    });

    it("treats all user messages as single round", () => {
      const messages: LoopMessage[] = [
        createMessage("user", "A".repeat(300)),
        createMessage("user", "B".repeat(300)),
        createMessage("user", "C".repeat(300)),
      ];

      const config: TrimConfig = {
        ...defaultConfig,
        charBudget: 500,
        keepLastRounds: 1,
      };

      trimMessages(messages, config);

      // All messages are in the same round, so all should be protected
      expect(messages[0].content).toBe("A".repeat(300));
      expect(messages[1].content).toBe("B".repeat(300));
      expect(messages[2].content).toBe("C".repeat(300));
    });
  });

  describe("All assistant messages", () => {
    it("handles array with only assistant messages", () => {
      const messages: LoopMessage[] = [
        createMessage("assistant", "Response 1"),
        createMessage("assistant", "Response 2"),
        createMessage("assistant", "Response 3"),
      ];

      expect(() => trimMessages(messages, defaultConfig)).not.toThrow();
    });
  });

  describe("Empty and single message arrays", () => {
    it("handles empty array gracefully", () => {
      const messages: LoopMessage[] = [];
      expect(() => trimMessages(messages, defaultConfig)).not.toThrow();
      expect(messages).toHaveLength(0);
    });

    it("handles single message array", () => {
      const messages: LoopMessage[] = [createMessage("user", "Only message")];
      expect(() => trimMessages(messages, defaultConfig)).not.toThrow();
      expect(messages).toHaveLength(1);
    });
  });

  describe("keepLastRounds protection", () => {
    it("protects correct number of rounds", () => {
      const messages: LoopMessage[] = [
        createMessage("user", "A".repeat(200)),
        createMessage("assistant", "B".repeat(200)),
        createMessage("user", "C".repeat(200)),
        createMessage("assistant", "D".repeat(200)),
        createMessage("user", "E".repeat(200)),
        createMessage("assistant", "F".repeat(200)),
      ];

      const config: TrimConfig = {
        ...defaultConfig,
        charBudget: 500,
        keepLastRounds: 2, // Protect last 2 rounds
      };

      trimMessages(messages, config);

      // Last 2 rounds (C+D and E+F) should be protected
      expect(messages[2].content).toBe("C".repeat(200));
      expect(messages[3].content).toBe("D".repeat(200));
      expect(messages[4].content).toBe("E".repeat(200));
      expect(messages[5].content).toBe("F".repeat(200));

      // First round (A+B) should be trimmed
      const firstRoundChars =
        (messages[0].content as string).length + (messages[1].content as string).length;
      expect(firstRoundChars).toBeLessThan(400); // Original was 400 chars
    });

    it("handles keepLastRounds exceeding total rounds", () => {
      const messages: LoopMessage[] = [
        createMessage("user", "A".repeat(200)),
        createMessage("assistant", "B".repeat(200)),
      ];

      const config: TrimConfig = {
        ...defaultConfig,
        charBudget: 500,
        keepLastRounds: 10, // More than available rounds
      };

      trimMessages(messages, config);

      // All messages should be protected
      expect(messages[0].content).toBe("A".repeat(200));
      expect(messages[1].content).toBe("B".repeat(200));
    });
  });

  describe("Budget overflow with keepLastRounds", () => {
    it("protects last rounds even if over budget", () => {
      const messages: LoopMessage[] = [
        createMessage("user", "A".repeat(100)),
        createMessage("assistant", "B".repeat(100)),
        createMessage("user", "C".repeat(100)),
        createMessage("assistant", "D".repeat(100)),
        createMessage("user", "E".repeat(300)),
        createMessage("assistant", "F".repeat(300)),
      ];

      const config: TrimConfig = {
        ...defaultConfig,
        charBudget: 500,
        keepLastRounds: 2, // Protect last 2 rounds
      };

      trimMessages(messages, config);

      // Last 2 rounds protected even though they exceed budget
      expect(messages[2].content).toBe("C".repeat(100));
      expect(messages[3].content).toBe("D".repeat(100));
      expect(messages[4].content).toBe("E".repeat(300));
      expect(messages[5].content).toBe("F".repeat(300));
    });
  });

  describe("Soft trim within protected rounds", () => {
    it("does not trim protected rounds", () => {
      const longContent = "X".repeat(500);
      const messages: LoopMessage[] = [
        createMessage("user", "A".repeat(100)),
        createMessage("assistant", "B".repeat(100)),
        createMessage("user", longContent),
        createMessage("assistant", "D".repeat(100)),
      ];

      const config: TrimConfig = {
        ...defaultConfig,
        charBudget: 400,
        keepLastRounds: 1, // Protect last round
      };

      trimMessages(messages, config);

      // Last round should remain untrimmed
      expect(messages[2].content).toBe(longContent);
      expect(messages[3].content).toBe("D".repeat(100));
    });
  });

  describe("Multimodal content", () => {
    it("handles UserContent arrays correctly", () => {
      const messages: LoopMessage[] = [
        createMultimodalMessage("user", "A".repeat(200)),
        createMessage("assistant", "B".repeat(200)),
        createMultimodalMessage("user", "C".repeat(200)),
        createMessage("assistant", "D".repeat(200)),
      ];

      const config: TrimConfig = {
        ...defaultConfig,
        charBudget: 500,
        keepLastRounds: 1,
      };

      expect(() => trimMessages(messages, config)).not.toThrow();

      // Last round protected
      expect(messages[2].content).toEqual([
        { type: "text", text: "C".repeat(200) },
        { type: "image", image: "base64data" },
      ]);
    });
  });

  describe("totalChars calculation", () => {
    it("calculates total chars for string content", () => {
      const messages: LoopMessage[] = [
        createMessage("user", "Hello"),
        createMessage("assistant", "World"),
      ];

      expect(totalChars(messages)).toBe(10);
    });

    it("calculates total chars for UserContent arrays", () => {
      const messages: LoopMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Hello" },
            { type: "image", image: "base64" },
          ],
        },
      ];

      // Should only count text parts
      expect(totalChars(messages)).toBe(5);
    });

    it("handles mixed content types", () => {
      const messages: LoopMessage[] = [
        createMessage("user", "Hello"),
        {
          role: "assistant",
          content: [{ type: "text", text: "World" }],
        },
      ];

      expect(totalChars(messages)).toBe(10);
    });
  });
});
