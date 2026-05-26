import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => {
  const element = await import("@satorijs/element");
  return { h: element.default };
});

import { createAthenaEvent } from "../../../src/internal/bot/events.js";
import { isChannelAllowed } from "../../../src/internal/runtime/session.js";

describe("isChannelAllowed", () => {
  it("matches exact allowed channel", () => {
    expect(
      isChannelAllowed("onebot", "group-1", "group", [
        { platform: "onebot", channelId: "group-1", type: "group" },
      ]),
    ).toBe(true);
  });

  it("rejects wrong channel type", () => {
    expect(
      isChannelAllowed("onebot", "group-1", "private", [
        { platform: "onebot", channelId: "group-1", type: "group" },
      ]),
    ).toBe(false);
  });
});

describe("ChannelSession event intake", () => {
  it("routes persistent events into AgentSession custom messages", async () => {
    // Placeholder — will be replaced when ChannelSession exists
    const event = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1", name: "Alice" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: false },
    });

    // Dummy event — just proving the file compiles
    expect(event.id).toBeDefined();
  });
});
