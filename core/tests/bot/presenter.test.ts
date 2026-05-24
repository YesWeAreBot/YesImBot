import { describe, expect, it } from "vitest";

import { createAthenaEvent, serializeAthenaEvent } from "../../src/bot/events.js";
import {
  createDefaultChatMessagePresenter,
  createPresenterRegistry,
} from "../../src/bot/presenter.js";

describe("PresenterRegistry", () => {
  it("presents chat_message as LLM-visible content with structured details", async () => {
    const registry = createPresenterRegistry();
    registry.registerBase("chat_message", createDefaultChatMessagePresenter());

    const event = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1", name: "Alice" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: false },
    });

    const presentation = await registry.present(event, { selfId: "bot-1" });

    expect(presentation).toEqual({
      visible: true,
      content: expect.stringContaining("Alice (user-1): hello"),
      text: "Alice: hello",
      details: serializeAthenaEvent(event),
    });
  });

  it("returns null when no base presenter is registered", async () => {
    const registry = createPresenterRegistry();
    const event = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: false },
    });

    await expect(registry.present(event, { selfId: "bot-1" })).resolves.toBeNull();
  });

  it("rejects duplicate base presenter registration", () => {
    const registry = createPresenterRegistry();
    const presenter = createDefaultChatMessagePresenter();

    registry.registerBase("chat_message", presenter);

    expect(() => registry.registerBase("chat_message", presenter)).toThrow(
      'Base presenter for "chat_message" is already registered',
    );
  });
});
