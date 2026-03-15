import { describe, expect, it, vi } from "vitest";

import { CorePlugin } from "../src/services/plugin/builtin";

describe("CorePlugin.execute tool", () => {
  function createPlugin() {
    const formatter = {
      format: vi.fn(() => "command output"),
    };

    const ctx = {
      on: vi.fn(),
      logger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
      "yesimbot.formatter": formatter,
    };

    const plugin = new CorePlugin(ctx as never);
    return { plugin, formatter };
  }

  it("registers execute as a built-in tool", () => {
    const { plugin } = createPlugin();

    expect(plugin.tools.has("execute")).toBe(true);
  });

  it("executes a Koishi command through session.execute and formats the output", async () => {
    const { plugin, formatter } = createPlugin();
    const session = {
      execute: vi.fn(async () => [{ type: "text", attrs: { content: "raw output" }, children: [] }]),
      send: vi.fn(async () => []),
    };

    const result = await plugin.executeCommand(
      { command: "help weather" },
      {
        platform: "discord",
        channelId: "channel-1",
        session: session as never,
      },
    );

    expect(session.execute).toHaveBeenCalledWith("help weather", true);
    expect(formatter.format).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      status: "success",
      content: "command output",
    });
    expect(session.send).not.toHaveBeenCalled();
  });

  it("can expose captured command output to the user when requested", async () => {
    const { plugin, formatter } = createPlugin();
    const session = {
      execute: vi.fn(async () => [{ type: "text", attrs: { content: "raw output" }, children: [] }]),
      send: vi.fn(async () => []),
    };

    const result = await plugin.executeCommand(
      { command: "help weather", expose_to_user: true },
      {
        platform: "discord",
        channelId: "channel-1",
        session: session as never,
      },
    );

    expect(session.execute).toHaveBeenCalledWith("help weather", true);
    expect(formatter.format).toHaveBeenCalledTimes(1);
    expect(session.send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      status: "success",
      content: "command output",
    });
  });

  it("fails cleanly when no active session is available", async () => {
    const { plugin } = createPlugin();

    const result = await plugin.executeCommand(
      { command: "help" },
      {
        platform: "discord",
        channelId: "channel-1",
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("No active session");
  });
});
