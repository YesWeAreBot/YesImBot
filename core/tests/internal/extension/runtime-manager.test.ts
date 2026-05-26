import { AgentTool } from "@yesimbot/agent";
import type { SessionManager } from "@yesimbot/agent/session";
import { HookRunner } from "@yesimbot/agent/session";
import { describe, expect, it, vi } from "vitest";

import { ExtensionRuntimeManager } from "../../../src/internal/extension/runtime.js";
import type {
  Channel,
  ExtensionContext,
  ExtensionDefinition,
  ExtensionToolSnapshot,
} from "../../../src/services/extension/types.js";

function createManager(definitions: ExtensionDefinition[] = []) {
  const logger = { level: 2, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return new ExtensionRuntimeManager({
    logger: logger as never,
    getDefinitions: () => definitions,
  });
}

function createRuntimeOptions(channel: Partial<Channel> = {}) {
  const hookRunner = new HookRunner(() => ({
    sessionManager: {} as SessionManager,
    model: undefined,
    isIdle: () => true,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
  }));
  return {
    channel: { platform: "onebot", channelId: "123", type: "group", ...channel } as Channel,
    hookRunner,
    sessionManager: {} as SessionManager,
    applyToolState: vi.fn<(snapshot: ExtensionToolSnapshot) => void>(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendUserMessage: vi.fn().mockResolvedValue(undefined),
    appendEntry: vi.fn(),
    setSessionName: vi.fn(),
    getSessionName: vi.fn().mockReturnValue(undefined),
    getActiveTools: vi.fn().mockReturnValue([]),
    setActiveTools: vi.fn(),
    registerSpeakElement: vi.fn().mockReturnValue(() => {}),
  };
}

describe("ExtensionRuntimeManager", () => {
  it("sets up extensions and installs hooks per channel", async () => {
    const handler = vi.fn();
    const extension: ExtensionDefinition = {
      id: "core-owned",
      setup(ctx: ExtensionContext) {
        ctx.on("agent:start", handler);
      },
    };
    const manager = createManager([extension]);
    const runtime = await manager.createChannelRuntime(createRuntimeOptions());

    await runtime.hookRunner.emitLifecycle({ type: "agent:start" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(runtime.errors).toEqual([]);
  });

  it("collects tools and applies one snapshot through the channel host", async () => {
    const execute = vi.fn();
    const tool: AgentTool = {
      description: "Tool from extension",
      inputSchema: undefined as never,
      execute,
    };
    const manager = createManager([
      {
        id: "tool-ext",
        setup(ctx) {
          ctx.registerTool({ name: "ext_tool", ...tool });
        },
      },
    ]);
    const options = createRuntimeOptions();

    await manager.createChannelRuntime(options);

    expect(options.applyToolState).toHaveBeenCalledTimes(1);
    const snapshot = vi.mocked(options.applyToolState).mock.calls[0][0];
    expect(snapshot.tools.get("ext_tool")).toMatchObject({ description: "Tool from extension" });
    expect(snapshot.activeToolNames).toEqual(["ext_tool"]);
  });

  it("disposes old bindings and reloads active channels when definitions change", async () => {
    const cleanup = vi.fn();
    const definitions: ExtensionDefinition[] = [
      { id: "ext-a", setup: vi.fn(() => ({ dispose: cleanup })) },
    ];
    const manager = createManager(definitions);
    const options = createRuntimeOptions();

    await manager.createChannelRuntime(options);
    definitions.splice(0, 1, { id: "ext-b", setup: vi.fn() });
    const summary = await manager.reloadAllChannels("registered:ext-b");

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      totalChannels: 1,
      successCount: 1,
      failureCount: 0,
      allSucceeded: true,
    });
  });

  it("passes Koishi channel context including bot to extension setup", async () => {
    const bot = { selfId: "bot-001", user: { name: "Athena" } };
    const seen: Array<ExtensionContext["channel"]> = [];
    const manager = createManager([
      {
        id: "channel-ext",
        setup(ctx) {
          seen.push(ctx.channel);
        },
      },
    ]);

    await manager.createChannelRuntime(createRuntimeOptions({ bot: bot as never }));

    expect(seen).toEqual([
      expect.objectContaining({
        platform: "onebot",
        channelId: "123",
        type: "group",
        bot,
      }),
    ]);
  });

  it("keeps successful extension setup when another extension fails", async () => {
    const goodHandler = vi.fn();
    const manager = createManager([
      {
        id: "bad",
        setup() {
          throw new Error("setup failed");
        },
      },
      {
        id: "good",
        setup(ctx) {
          ctx.on("agent:start", goodHandler);
        },
      },
    ]);

    const runtime = await manager.createChannelRuntime(createRuntimeOptions());

    expect(runtime.errors).toEqual([
      expect.objectContaining({ extensionId: "bad", error: "setup failed" }),
    ]);
    await runtime.hookRunner.emitLifecycle({ type: "agent:start" });
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  it("lets extensions register speak elements through ctx.bot", async () => {
    const manager = createManager([
      {
        id: "sticker-ext",
        setup(ctx) {
          ctx.bot.registerSpeakElement({
            tag: "sticker",
            syntax: '<sticker name="NAME"/>',
            description: "Send a known sticker by name.",
            examples: ['<sticker name="吃瓜"/>'],
          });
        },
      },
    ]);

    const options = createRuntimeOptions({
      platform: "test",
      channelId: "chan",
      type: "group",
    });
    await manager.createChannelRuntime(options);

    expect(manager.getPromptSpeakElementContext(options.channel)).toEqual({
      elements: [
        {
          tag: "sticker",
          syntax: '<sticker name="NAME"/>',
          description: "Send a known sticker by name.",
          examples: ['<sticker name="吃瓜"/>'],
        },
      ],
    });
  });

  it("removes speak elements when definitions change and channel reloads", async () => {
    const definitions: ExtensionDefinition[] = [
      {
        id: "sticker-ext",
        setup(ctx) {
          ctx.bot.registerSpeakElement({
            tag: "sticker",
            syntax: '<sticker name="NAME"/>',
            description: "Send a known sticker by name.",
          });
        },
      },
    ];
    const manager = createManager(definitions);
    const options = createRuntimeOptions();

    await manager.createChannelRuntime(options);
    expect(manager.getPromptSpeakElementContext(options.channel).elements).toHaveLength(1);

    definitions.splice(0, 1);
    await manager.reloadAllChannels("unregistered:sticker-ext");

    expect(manager.getPromptSpeakElementContext(options.channel).elements).toEqual([]);
  });

  it("disposes registered speak elements when channel runtime is cleaned up", async () => {
    const disposer = vi.fn();
    const manager = createManager([
      {
        id: "sticker-ext",
        setup(ctx) {
          ctx.bot.registerSpeakElement({
            tag: "sticker",
            syntax: '<sticker name="NAME"/>',
            description: "Send a known sticker by name.",
          });
        },
      },
    ]);

    const options = createRuntimeOptions();
    options.registerSpeakElement = vi.fn().mockReturnValue(disposer);

    const runtime = await manager.createChannelRuntime(options);

    expect(options.registerSpeakElement).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "sticker",
      }),
    );

    await runtime.dispose();

    expect(disposer).toHaveBeenCalledTimes(1);
  });
});
