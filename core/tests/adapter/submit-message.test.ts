import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => ({
  h: {
    parse(content: string) {
      return [{ type: "text", attrs: { content }, children: [] }];
    },
  },
}));

import { GenericAdapter } from "../../src/adapter/generic.js";

describe("PlatformAdapter submitMessage", () => {
  it("GenericAdapter has submitMessage as a function", () => {
    const adapter = new GenericAdapter({} as never, {});
    expect(typeof adapter.submitMessage).toBe("function");
  });

  it("GenericAdapter.submitMessage delegates to bot.sendMessage and returns ok", async () => {
    const bot = { sendMessage: vi.fn().mockResolvedValue(["m1"]) };
    const adapter = new GenericAdapter({} as never, {});
    const result = await adapter.submitMessage!({
      channelId: "123",
      platform: "*",
      text: "hello",
      bot: bot as never,
    });

    expect(result).toEqual({ ok: true });
    expect(bot.sendMessage).toHaveBeenCalledWith("123", "hello");
  });

  it("GenericAdapter.submitMessage returns error on failure", async () => {
    const error = new Error("send failed");
    const bot = { sendMessage: vi.fn().mockRejectedValue(error) };
    const adapter = new GenericAdapter({} as never, {});
    const result = await adapter.submitMessage!({
      channelId: "123",
      platform: "*",
      text: "hello",
      bot: bot as never,
    });

    expect(result).toEqual({ ok: false, error });
  });

  it("submitMessage accepts optional quoteMessageId", async () => {
    const bot = { sendMessage: vi.fn().mockResolvedValue(["m1"]) };
    const adapter = new GenericAdapter({} as never, {});
    const result = await adapter.submitMessage!({
      channelId: "123",
      platform: "*",
      text: "hello",
      quoteMessageId: "q1",
      bot: bot as never,
    });

    expect(result).toEqual({ ok: true });
  });
});
