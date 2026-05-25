import { describe, expect, it, vi } from "vitest";

import { createAthenaEvent } from "../../src/bot/events.js";
import { serializeAthenaEvent } from "../../src/bot/events.js";
import { createChannelRuntime, isChannelAllowed } from "../../src/runtime/channel-runtime.js";

function createAgentSession() {
  const listeners: Array<(event: unknown) => void> = [];
  const unsubscribe = vi.fn();

  return {
    session: {
      sendCustomMessage: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn((listener: (event: unknown) => void) => {
        listeners.push(listener);
        return unsubscribe;
      }),
      dispose: vi.fn(),
    },
    emit(event: unknown) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    unsubscribe,
  };
}

function createBot() {
  return {
    present: vi.fn().mockResolvedValue({
      visible: true,
      content: "Alice: hello",
      details: { version: 1, kind: "chat_message" },
    }),
    speak: vi.fn().mockResolvedValue({ ok: true, anomalies: [] }),
  };
}

function createWillingManager() {
  return {
    shouldReply: vi.fn().mockReturnValue({ decision: false, probability: 0 }),
  };
}

describe("Channel Runtime event intake", () => {
  it("persists a presented event and triggers a turn when allowed and trigger candidate", async () => {
    const agentSession = createAgentSession();
    const bot = createBot();
    const willingManager = createWillingManager();
    const runtime = createChannelRuntime({
      channel: { platform: "onebot", channelId: "group-1", type: "group" },
      bot: bot as never,
      agentSession: agentSession.session as never,
      willingManager: willingManager as never,
      allowedChannels: [{ platform: "onebot", channelId: "group-1", type: "group" }],
      sessionManager: { appendCustomEntry: vi.fn() } as never,
    });
    const event = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: true },
    });

    await runtime.handleEvent(event);

    expect(agentSession.session.sendCustomMessage).toHaveBeenCalledWith(
      {
        customType: "athena:event",
        content: "Alice: hello",
        display: true,
        details: { version: 1, kind: "chat_message" },
      },
      { triggerTurn: true, deliverAs: "followUp" },
    );
  });

  it("does not persist a hidden event when it neither persists nor triggers a turn", async () => {
    const agentSession = createAgentSession();
    const bot = createBot();
    const willingManager = createWillingManager();
    const runtime = createChannelRuntime({
      channel: { platform: "onebot", channelId: "group-1", type: "group" },
      bot: bot as never,
      agentSession: agentSession.session as never,
      willingManager: willingManager as never,
      allowedChannels: [],
      sessionManager: { appendCustomEntry: vi.fn() } as never,
    });
    const event = createAthenaEvent("reaction", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1" },
      payload: { messageId: "m-1", emoji: "👍", action: "add" },
      metadata: { persist: false, triggerCandidate: false },
    });

    await runtime.handleEvent(event);

    expect(agentSession.session.sendCustomMessage).not.toHaveBeenCalled();
  });

  it("persists serialized event details when presenter returns null for a persistent event", async () => {
    const agentSession = createAgentSession();
    const bot = {
      present: vi.fn().mockResolvedValue(null),
      speak: vi.fn().mockResolvedValue({ ok: true, anomalies: [] }),
    };
    const willingManager = createWillingManager();
    const runtime = createChannelRuntime({
      channel: { platform: "onebot", channelId: "group-1", type: "group" },
      bot: bot as never,
      agentSession: agentSession.session as never,
      willingManager: willingManager as never,
      allowedChannels: [],
      sessionManager: { appendCustomEntry: vi.fn() } as never,
    });
    const event = createAthenaEvent("reaction", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1" },
      payload: { messageId: "m-1", emoji: "👍", action: "add" },
      metadata: { persist: true, triggerCandidate: false },
    });

    await runtime.handleEvent(event);

    expect(agentSession.session.sendCustomMessage).toHaveBeenCalledWith(
      {
        customType: "athena:event",
        content: [],
        display: false,
        details: serializeAthenaEvent(event),
      },
      { triggerTurn: false },
    );
  });

  it("does not trigger a turn when channel is not allowed", async () => {
    const agentSession = createAgentSession();
    const bot = createBot();
    const willingManager = createWillingManager();
    const runtime = createChannelRuntime({
      channel: { platform: "onebot", channelId: "group-1", type: "group" },
      bot: bot as never,
      agentSession: agentSession.session as never,
      willingManager: willingManager as never,
      allowedChannels: [],
      sessionManager: { appendCustomEntry: vi.fn() } as never,
    });
    const event = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: true },
    });

    await runtime.handleEvent(event);

    expect(agentSession.session.sendCustomMessage).toHaveBeenCalledWith(expect.any(Object), {
      triggerTurn: false,
    });
  });

  it("subscribes assistant message_end output to AthenaBot.speak using origin session", async () => {
    const agentSession = createAgentSession();
    const bot = createBot();
    const willingManager = createWillingManager();
    const runtime = createChannelRuntime({
      channel: { platform: "onebot", channelId: "group-1", type: "group" },
      bot: bot as never,
      agentSession: agentSession.session as never,
      willingManager: willingManager as never,
      allowedChannels: [{ platform: "onebot", channelId: "group-1", type: "group" }],
      sessionManager: { appendCustomEntry: vi.fn() } as never,
    });
    const originSession = { send: vi.fn() };
    const event = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: true },
    });

    await runtime.handleEvent(event, { originSession: originSession as never });

    agentSession.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "hello" },
          { type: "reasoning", text: "ignored" },
          { type: "text", text: " world" },
        ],
      },
    });

    expect(bot.speak).toHaveBeenCalledWith("hello world", {
      originSession,
      modelElapsedMs: 0,
    });
  });

  it("keeps the triggering origin session when a later non-triggering event arrives before assistant output", async () => {
    const agentSession = createAgentSession();
    const bot = createBot();
    const willingManager = createWillingManager();
    const runtime = createChannelRuntime({
      channel: { platform: "onebot", channelId: "group-1", type: "group" },
      bot: bot as never,
      agentSession: agentSession.session as never,
      willingManager: willingManager as never,
      allowedChannels: [{ platform: "onebot", channelId: "group-1", type: "group" }],
      sessionManager: { appendCustomEntry: vi.fn() } as never,
    });
    const originSessionA = { send: vi.fn() };
    const originSessionB = { send: vi.fn() };
    const triggeringEvent = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: true },
    });
    const laterNonTriggeringEvent = createAthenaEvent("reaction", {
      source: { platform: "onebot", channelId: "group-2", conversationType: "group" },
      actor: { id: "user-2" },
      payload: { messageId: "m-2", emoji: "👍", action: "add" },
      metadata: { persist: true, triggerCandidate: false },
    });

    await runtime.handleEvent(triggeringEvent, { originSession: originSessionA as never });
    await runtime.handleEvent(laterNonTriggeringEvent, { originSession: originSessionB as never });

    agentSession.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "reply" }],
      },
    });

    expect(bot.speak).toHaveBeenCalledWith("reply", {
      originSession: originSessionA,
      modelElapsedMs: 0,
    });
  });

  it("does not consume pending origin session for assistant messages without text", async () => {
    const agentSession = createAgentSession();
    const bot = createBot();
    const willingManager = createWillingManager();
    const runtime = createChannelRuntime({
      channel: { platform: "onebot", channelId: "group-1", type: "group" },
      bot: bot as never,
      agentSession: agentSession.session as never,
      willingManager: willingManager as never,
      allowedChannels: [{ platform: "onebot", channelId: "group-1", type: "group" }],
      sessionManager: { appendCustomEntry: vi.fn() } as never,
    });
    const originSession = { send: vi.fn() };
    const event = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: true },
    });

    await runtime.handleEvent(event, { originSession: originSession as never });

    agentSession.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "reasoning", text: "ignored" }],
      },
    });
    agentSession.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "reply" }],
      },
    });

    expect(bot.speak).toHaveBeenCalledTimes(1);
    expect(bot.speak).toHaveBeenCalledWith("reply", {
      originSession,
      modelElapsedMs: 0,
    });
  });

  it("does not retain an origin session when triggering message persistence fails", async () => {
    const agentSession = createAgentSession();
    const bot = createBot();
    const willingManager = createWillingManager();
    const runtime = createChannelRuntime({
      channel: { platform: "onebot", channelId: "group-1", type: "group" },
      bot: bot as never,
      agentSession: agentSession.session as never,
      willingManager: willingManager as never,
      allowedChannels: [{ platform: "onebot", channelId: "group-1", type: "group" }],
      sessionManager: { appendCustomEntry: vi.fn() } as never,
    });
    const failedOriginSession = { send: vi.fn() };
    const successfulOriginSession = { send: vi.fn() };
    const failedEvent = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: {
        persist: true,
        triggerCandidate: true,
      },
    });
    const successfulEvent = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-2" },
      payload: { messageId: "m-2", content: "hello again" },
      metadata: {
        persist: true,
        triggerCandidate: true,
      },
    });

    vi.mocked(agentSession.session.sendCustomMessage)
      .mockRejectedValueOnce(new Error("persist failed"))
      .mockResolvedValueOnce(undefined);

    await expect(
      runtime.handleEvent(failedEvent, { originSession: failedOriginSession as never }),
    ).rejects.toThrow("persist failed");
    await runtime.handleEvent(successfulEvent, { originSession: successfulOriginSession as never });

    agentSession.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "reply" }],
      },
    });

    expect(bot.speak).toHaveBeenCalledWith("reply", {
      originSession: successfulOriginSession,
      modelElapsedMs: 0,
    });
  });

  it("exports channel allowlist helper", () => {
    expect(
      isChannelAllowed("onebot", "group-1", "group", [
        { platform: "onebot", channelId: "group-1", type: "group" },
      ]),
    ).toBe(true);
    expect(
      isChannelAllowed("onebot", "group-2", "group", [
        { platform: "*", channelId: "*", type: "private" },
      ]),
    ).toBe(false);
  });

  it("disposes the subscription and underlying agent session", () => {
    const agentSession = createAgentSession();
    const bot = createBot();
    const willingManager = createWillingManager();
    const runtime = createChannelRuntime({
      channel: { platform: "onebot", channelId: "group-1", type: "group" },
      bot: bot as never,
      agentSession: agentSession.session as never,
      willingManager: willingManager as never,
      allowedChannels: [],
      sessionManager: { appendCustomEntry: vi.fn() } as never,
    });

    runtime.dispose();

    expect(agentSession.unsubscribe).toHaveBeenCalledTimes(1);
    expect(agentSession.session.dispose).toHaveBeenCalledTimes(1);
  });
});
