import { describe, expect, it } from "vitest";

import {
  buildGenerateInputForTest,
  createAgentAssistantMessage,
  normalizeAssistantContent,
} from "../../src/services/session/channel-agent";
import type { ResponseEndRecord } from "../../src/services/session/types";

describe("ChannelAgent plugin safety helpers", () => {
  it("normalizes assistant tool-call parts for persistence", () => {
    const content = normalizeAssistantContent([
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "write_file",
        input: { path: "../outside.txt" },
      },
    ]);

    expect(content).toEqual([
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "write_file",
        args: { path: "../outside.txt" },
      },
    ]);
  });

  it("keeps response_end error shape stable for persistence", () => {
    const record: ResponseEndRecord = {
      endReason: "error",
      durationMs: 1200,
      stepsCompleted: 2,
      error: "plugin execution failed",
    };

    expect(record).toMatchObject({
      endReason: "error",
      stepsCompleted: 2,
      error: expect.stringContaining("plugin"),
    });
  });

  it("builds generation payload with system instruction boundary", () => {
    const { messages } = buildGenerateInputForTest({
      instructions: "test-instruction",
      sessionEntries: [],
    });

    expect(messages[0]).toEqual({ role: "system", content: "test-instruction" });
  });

  it("preserves finish reason in assistant payload", () => {
    const assistant = createAgentAssistantMessage({
      content: "done",
      finishReason: "error",
    });

    expect(assistant.finishReason).toBe("error");
  });
});
