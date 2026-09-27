import { describe, expect, it, vi } from "vitest";

import MemoryAgentPlugin from "../src/index.js";

const context = {
  baseDir: "/tmp",
  logger: () => ({ warn: vi.fn(), success: vi.fn(), info: vi.fn() }),
  yesimbot: {
    model: { resolveChatModel: vi.fn(() => ({ model: {} })) },
    agent: { use: vi.fn(() => vi.fn()) },
    conversation: { read: vi.fn() },
  },
  on: vi.fn(),
};

describe("MemoryAgentPlugin", () => {
  it("registers lifecycle handlers, memory table, and only public channel tools", async () => {
    const on = vi.fn();
    const agentUse = vi.fn(() => vi.fn());
    const ctx = {
      ...context,
      on,
      yesimbot: { ...context.yesimbot, agent: { use: agentUse } },
      model: { extend: vi.fn(), get: vi.fn(async () => []), set: vi.fn(), remove: vi.fn() },
    };
    const plugin = new MemoryAgentPlugin(ctx as never, { model: "test:model" });
    expect(on).toHaveBeenCalledWith("ready", expect.any(Function));
    expect(on).toHaveBeenCalledWith("dispose", expect.any(Function));
    await plugin.start();
    const factory = agentUse.mock.calls[0]![0];
    expect(factory.setup({ type: "guild", platform: "test", channelId: "room", guildId: "room" }, { selfId: "bot" })).toMatchObject({ name: "memory-agent" });
    const channelPlugin = factory.setup({ type: "guild", platform: "test", channelId: "room", guildId: "room" }, { selfId: "bot" });
    expect(Object.keys((await channelPlugin.extendTools!())!)).toEqual(["remember", "recall", "search"]);
    await plugin.stop();
  });
});
