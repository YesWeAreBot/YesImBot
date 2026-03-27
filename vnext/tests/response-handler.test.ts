import { describe, expect, it, vi } from "vitest";

import { bindResponseDispatch } from "../src/services/session/response/dispatch";
import { createChannelTools } from "../src/services/session/tool/tools";

interface SessionHarness {
  session: {
    subscribe: ReturnType<typeof vi.fn>;
  };
  emit: (event: unknown) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function createSessionHarness(): SessionHarness {
  let listener: ((event: unknown) => void) | undefined;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((nextListener: (event: unknown) => void) => {
    listener = nextListener;
    return unsubscribe;
  });

  return {
    session: { subscribe },
    emit: (event: unknown) => {
      if (!listener) {
        throw new Error("listener not attached");
      }
      listener(event);
    },
    unsubscribe,
  };
}

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("response handler", () => {
  it("subscribes and returns unsubscribe function", () => {
    const { session, unsubscribe } = createSessionHarness();
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const injectSystemMessage = vi.fn();

    const detach = bindResponseDispatch(
      session as never,
      { sendFn, injectSystemMessage, channelKey: "discord:channel-1" },
      { maxChars: 1800 },
    );

    expect(session.subscribe).toHaveBeenCalledTimes(1);
    detach();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("sends assistant text on turn_end", async () => {
    const { session, emit } = createSessionHarness();
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const injectSystemMessage = vi.fn();

    bindResponseDispatch(
      session as never,
      { sendFn, injectSystemMessage, channelKey: "discord:channel-1" },
      { maxChars: 1800 },
    );

    emit({
      type: "turn_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello from assistant" }],
      },
      toolResults: [],
    });

    await flushAsync();

    expect(sendFn).toHaveBeenCalledWith("hello from assistant");
    expect(injectSystemMessage).toHaveBeenCalledWith("Message delivered successfully.");
  });

  it("splits long text and sends multiple segments", async () => {
    const { session, emit } = createSessionHarness();
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const injectSystemMessage = vi.fn();

    bindResponseDispatch(
      session as never,
      { sendFn, injectSystemMessage, channelKey: "discord:channel-1" },
      { maxChars: 1800 },
    );

    const longText = `${"A".repeat(1200)}\n\n${"B".repeat(1200)}`;
    emit({
      type: "turn_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: longText }],
      },
      toolResults: [],
    });

    await flushAsync();

    expect(sendFn.mock.calls.length).toBeGreaterThan(1);
    expect(injectSystemMessage.mock.calls.length).toBe(sendFn.mock.calls.length);
  });

  it("skips turn_end text send after terminal tool execution", async () => {
    const { session, emit } = createSessionHarness();
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const injectSystemMessage = vi.fn();

    createChannelTools({
      sendFn,
      platform: "discord",
      channelId: "channel-1",
      selfId: "bot-1",
      sessionDir: "/tmp/athena-test-session",
    });

    bindResponseDispatch(
      session as never,
      { sendFn, injectSystemMessage, channelKey: "discord:channel-1" },
      { maxChars: 1800 },
    );

    emit({ type: "turn_start" });
    emit({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "send_message",
      result: { content: [{ type: "text", text: "ok" }], details: {} },
      isError: false,
    });
    emit({
      type: "turn_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "should not be sent" }],
      },
      toolResults: [],
    });

    await flushAsync();

    expect(sendFn).not.toHaveBeenCalledWith("should not be sent");
    expect(injectSystemMessage).not.toHaveBeenCalled();
  });

  it("injects failure status when sendFn rejects", async () => {
    const { session, emit } = createSessionHarness();
    const sendFn = vi.fn().mockRejectedValue(new Error("network down"));
    const injectSystemMessage = vi.fn();

    bindResponseDispatch(
      session as never,
      { sendFn, injectSystemMessage, channelKey: "discord:channel-1" },
      { maxChars: 1800 },
    );

    emit({
      type: "turn_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "send this" }],
      },
      toolResults: [],
    });

    await flushAsync();

    expect(sendFn).toHaveBeenCalledWith("send this");
    expect(injectSystemMessage).toHaveBeenCalledWith("Failed to deliver message: network down");
  });

  it("does not send for empty assistant text", async () => {
    const { session, emit } = createSessionHarness();
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const injectSystemMessage = vi.fn();

    bindResponseDispatch(
      session as never,
      { sendFn, injectSystemMessage, channelKey: "discord:channel-1" },
      { maxChars: 1800 },
    );

    emit({
      type: "turn_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "   " }],
      },
      toolResults: [],
    });

    await flushAsync();

    expect(sendFn).not.toHaveBeenCalled();
    expect(injectSystemMessage).not.toHaveBeenCalled();
  });
});
