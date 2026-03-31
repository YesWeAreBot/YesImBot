import { describe, expect, it } from "vitest";

import {
  buildGenerateInputForTest,
  createAgentAssistantMessage,
  normalizeAssistantContent,
} from "../../src/services/session/channel-agent";
import { TurnFinalizer } from "../../src/services/session/channel-agent/finalization/turn-finalizer";
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

  it("keeps response_end exception shape stable for persistence", () => {
    const record: ResponseEndRecord = {
      endReason: "exception",
      durationMs: 1200,
      stepsCompleted: 2,
      error: "plugin execution failed",
    };

    expect(record).toMatchObject({
      endReason: "exception",
      stepsCompleted: 2,
      error: expect.stringContaining("plugin"),
    });
  });

  it("all six exact reason strings resolve from finalizer matrix", () => {
    const finalizer = new TurnFinalizer();

    expect(
      finalizer.resolveEndReason({
        aborted: false,
        timedOut: false,
        protocolError: false,
        heartbeatRequested: false,
        sendFailure: false,
      }),
    ).toBe("normal");
    expect(
      finalizer.resolveEndReason({
        aborted: false,
        timedOut: false,
        protocolError: false,
        heartbeatRequested: true,
        sendFailure: false,
      }),
    ).toBe("heartbeat_continuation");
    expect(
      finalizer.resolveEndReason({
        aborted: false,
        timedOut: false,
        protocolError: true,
        heartbeatRequested: true,
        sendFailure: false,
      }),
    ).toBe("protocol_error");
    expect(
      finalizer.resolveEndReason({
        aborted: false,
        timedOut: true,
        protocolError: false,
        heartbeatRequested: true,
        sendFailure: true,
      }),
    ).toBe("timeout");
    expect(
      finalizer.resolveEndReason({
        aborted: true,
        timedOut: false,
        protocolError: false,
        heartbeatRequested: true,
        sendFailure: true,
      }),
    ).toBe("abort");
    expect(
      finalizer.resolveEndReason({
        aborted: false,
        timedOut: false,
        protocolError: false,
        heartbeatRequested: false,
        sendFailure: true,
        thrownError: "transport failed",
      }),
    ).toBe("exception");
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
