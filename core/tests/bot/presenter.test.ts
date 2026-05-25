import { describe, expect, it } from "vitest";

import { createAthenaEvent, serializeAthenaEvent } from "../../src/bot/events.js";
import { createPresenterCatalog } from "../../src/bot/presenter-catalog.js";
import {
  createDefaultChatMessagePresenter,
  createDefaultMemberChangePresenter,
  createDefaultMessageRecallPresenter,
  createDefaultReactionPresenter,
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

  it("tracks presenter coverage for observer-declared event kinds", () => {
    const catalog = createPresenterCatalog();

    catalog.registerBase("chat_message", createDefaultChatMessagePresenter());

    expect(catalog.has("chat_message")).toBe(true);
    expect(catalog.has("reaction")).toBe(false);
  });

  it("materializes catalog presenters into a per-channel registry", async () => {
    const catalog = createPresenterCatalog();
    catalog.registerBase("chat_message", createDefaultChatMessagePresenter());

    const registry = createPresenterRegistry();
    catalog.applyTo(registry);

    const event = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1", name: "Alice" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: false },
    });

    await expect(registry.present(event, { selfId: "bot-1" })).resolves.toMatchObject({
      visible: true,
      text: "Alice: hello",
    });
  });

  it("rejects duplicate catalog presenters", () => {
    const catalog = createPresenterCatalog();
    const presenter = createDefaultChatMessagePresenter();

    catalog.registerBase("chat_message", presenter);

    expect(() => catalog.registerBase("chat_message", presenter)).toThrow(
      'Base presenter for "chat_message" is already registered',
    );
  });

  it("presents message_recall as event text with structured details", async () => {
    const registry = createPresenterRegistry();
    registry.registerBase("message_recall", createDefaultMessageRecallPresenter());
    const event = createAthenaEvent("message_recall", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "admin-1", name: "Admin" },
      payload: { messageId: "m-1", originalSender: { id: "user-1", name: "Alice" } },
      metadata: { persist: true, triggerCandidate: false },
    });

    await expect(registry.present(event, { selfId: "bot-1" })).resolves.toMatchObject({
      visible: true,
      content: expect.stringContaining("Admin recalled message m-1"),
      details: serializeAthenaEvent(event),
    });
  });

  it("presents reaction as event text with structured details", async () => {
    const registry = createPresenterRegistry();
    registry.registerBase("reaction", createDefaultReactionPresenter());
    const event = createAthenaEvent("reaction", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1", name: "Alice" },
      payload: { messageId: "m-1", emoji: "👍", action: "add" },
      metadata: { persist: true, triggerCandidate: false },
    });

    await expect(registry.present(event, { selfId: "bot-1" })).resolves.toMatchObject({
      visible: true,
      content: expect.stringContaining("Alice reacted 👍 to message m-1"),
      details: serializeAthenaEvent(event),
    });
  });

  it("presents member_change as event text with structured details", async () => {
    const registry = createPresenterRegistry();
    registry.registerBase("member_change", createDefaultMemberChangePresenter());
    const event = createAthenaEvent("member_change", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "admin-1", name: "Admin" },
      target: { id: "user-2", name: "Bob" },
      payload: { action: "join", groupId: "group-1" },
      metadata: { persist: true, triggerCandidate: false },
    });

    await expect(registry.present(event, { selfId: "bot-1" })).resolves.toMatchObject({
      visible: true,
      content: expect.stringContaining("Bob joined group group-1"),
      details: serializeAthenaEvent(event),
    });
  });
});
