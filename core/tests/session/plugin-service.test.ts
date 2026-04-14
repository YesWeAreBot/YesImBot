import type { Tool as AiTool, ToolExecutionOptions } from "@ai-sdk/provider-utils";
import type { Context, Logger } from "koishi";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
  class Service<TConfig = unknown> {
    protected ctx: unknown;
    protected config!: TConfig;
    protected logger: Logger;

    constructor(ctx: Context, name: string) {
      this.ctx = ctx;
      this.logger = ctx.logger(name);
    }
  }

  return {
    Context: class {},
    Service,
  };
});

import { Metadata, YesImPlugin, type ToolRuntime } from "../../../packages/plugin-sdk/src/index";
import { PluginService } from "../../src/services/plugin/service";

function createLoggerMock(): Logger {
  return {
    level: 2,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createContextMock(): Context {
  return {
    baseDir: "/tmp/athena-plugin-service",
    logger: vi.fn(() => createLoggerMock()),
    on: vi.fn(),
  } as unknown as Context;
}

function createToolRuntime(overrides: Partial<ToolRuntime> = {}): ToolRuntime {
  return {
    channelKey: "discord:channel-1",
    platform: "discord",
    channelId: "channel-1",
    modelId: "provider:model",
    basePath: "/tmp/athena-plugin-service",
    turn: {
      messageId: "msg-1",
      timestamp: 1_710_000_000_000,
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
    },
    ...overrides,
  };
}

function createAiTool(label: string, execute?: AiTool["execute"]): AiTool {
  return {
    description: `${label} tool`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    execute: execute ?? vi.fn(async () => label),
  } as unknown as AiTool;
}

@Metadata({ name: "search", description: "search plugin fixture" })
class SearchPlugin extends YesImPlugin {
  constructor(
    ctx: Context,
    private readonly executeSpy: ReturnType<typeof vi.fn>,
  ) {
    super(ctx);
    this.registerTool({
      name: "search_docs",
      description: "search docs",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
      match: ({ runtime }) => runtime.platform === "discord",
      extendResponse: (hostInput: { allowSearch?: boolean }) => ({
        channelPolicy: hostInput.allowSearch === true ? "enabled" : "disabled",
      }),
      enable: ({ responseContext }) => {
        const context = responseContext.search?.search_docs as
          | { channelPolicy?: "enabled" | "disabled" }
          | undefined;
        return context?.channelPolicy === "enabled";
      },
      execute: async (input, options) => await this.executeSpy(input, options),
    });
  }
}

@Metadata({ name: "scoped", description: "scoped plugin fixture" })
class ScopedPlugin extends YesImPlugin {
  constructor(ctx: Context) {
    super(ctx);
    this.registerTool({
      name: "scoped_tool",
      description: "scoped tool",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      execute: async () => "scoped_tool",
    });
  }
}

@Metadata({ name: "reserved", description: "reserved name plugin" })
class ReservedNamePlugin extends YesImPlugin {
  constructor(ctx: Context) {
    super(ctx);
    this.registerTool({
      name: "send_message",
      description: "reserved tool",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      execute: async () => "reserved",
    });
  }
}

@Metadata({ name: "duplicate", description: "duplicate name plugin" })
class DuplicateNamePlugin extends YesImPlugin {
  constructor(ctx: Context) {
    super(ctx);
    this.registerTool({
      name: "search_docs",
      description: "duplicate tool",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      execute: async () => "duplicate",
    });
  }
}

describe("PluginService tool lifecycle", () => {
  it("compiles one stable catalog per channel key and reuses bound tool handles", async () => {
    const ctx = createContextMock();
    const service = new PluginService(ctx);
    const runtime = createToolRuntime();
    const sendMessageTool = createAiTool("send_message");

    await service.install(
      new SearchPlugin(
        ctx,
        vi.fn(async () => "search"),
      ),
    );

    const first = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
      hostInput: {},
      sendMessageTool,
    });
    const second = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
      hostInput: {},
      sendMessageTool,
    });

    expect(first.signature).toBe(second.signature);
    expect(first.tools.search_docs).toBe(second.tools.search_docs);
  });

  it("builds one response context per response start and selects tools from the cached catalog", async () => {
    const ctx = createContextMock();
    const service = new PluginService(ctx);
    const runtime = createToolRuntime();
    const sendMessageTool = createAiTool("send_message");

    await service.install(
      new SearchPlugin(
        ctx,
        vi.fn(async () => "search"),
      ),
    );

    const catalog = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
      hostInput: {},
      sendMessageTool,
    });
    const responseContext = await service.buildResponseContext({
      runtime,
      hostInput: { allowSearch: true },
      catalog,
    });
    const selection = await service.selectTools({
      runtime,
      catalog,
      responseContext,
      toolSettings: { enabled: ["search_docs"] },
    });

    expect(Object.keys(selection.activeTools)).toEqual(["send_message", "search_docs"]);
  });

  it("rejects selection when a required tool cannot be enabled", async () => {
    const ctx = createContextMock();
    const service = new PluginService(ctx);
    const runtime = createToolRuntime();
    const sendMessageTool = createAiTool("send_message");

    await service.install(
      new SearchPlugin(
        ctx,
        vi.fn(async () => "search"),
      ),
    );

    const catalog = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
      hostInput: {},
      sendMessageTool,
    });

    await expect(
      service.selectTools({
        runtime,
        catalog,
        responseContext: { search: { search_docs: { channelPolicy: "disabled" } } },
        toolSettings: { enabled: ["search_docs"], required: ["search_docs"] },
      }),
    ).rejects.toThrow("Required tools unavailable: search_docs");
  });

  it("rejects reserved and duplicate tool names during catalog compilation", async () => {
    const ctx = createContextMock();
    const service = new PluginService(ctx);
    const runtime = createToolRuntime();

    await service.install(
      new SearchPlugin(
        ctx,
        vi.fn(async () => "search"),
      ),
    );

    const reservedNamePlugin = new ReservedNamePlugin(ctx);
    const duplicateNamePlugin = new DuplicateNamePlugin(ctx);

    await expect(
      service.install(reservedNamePlugin, { scope: runtime.channelKey }),
    ).rejects.toThrow("Reserved tool name: send_message");
    await expect(
      service.install(duplicateNamePlugin, { scope: runtime.channelKey }),
    ).rejects.toThrow("Duplicate tool name: search_docs");
  });

  it("invalidates cached catalogs when provider visibility changes for a channel scope", async () => {
    const ctx = createContextMock();
    const service = new PluginService(ctx);
    const runtime = createToolRuntime();
    const sendMessageTool = createAiTool("send_message");

    await service.install(
      new SearchPlugin(
        ctx,
        vi.fn(async () => "search"),
      ),
    );

    const first = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
      hostInput: {},
      sendMessageTool,
    });

    const scopedPlugin = new ScopedPlugin(ctx);
    await service.install(scopedPlugin, { scope: runtime.channelKey });

    const second = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
      hostInput: {},
      sendMessageTool,
    });

    expect(second).not.toBe(first);
    expect(second.signature).toContain("scoped_tool");
    expect(Object.keys(second.tools)).toContain("scoped_tool");
  });

  it("invokes tools through the contextual catalog path", async () => {
    const ctx = createContextMock();
    const service = new PluginService(ctx);
    const runtime = createToolRuntime();
    const sendMessageTool = createAiTool("send_message");
    const executeSpy = vi.fn(async (input: unknown, options: ToolExecutionOptions) => ({
      input,
      toolCallId: options.toolCallId,
      context: options.experimental_context,
    }));

    await service.install(new SearchPlugin(ctx, executeSpy));
    await service.compileTools({
      runtime,
      scope: runtime.channelKey,
      hostInput: {},
      sendMessageTool,
    });

    await expect(
      service.invoke({
        name: "search_docs",
        input: { query: "athena" },
        runtime,
        scope: runtime.channelKey,
        hostInput: { allowSearch: true },
        toolSettings: { enabled: ["search_docs"] },
      }),
    ).resolves.toEqual({
      input: { query: "athena" },
      toolCallId: "invoke:search_docs",
      context: {
        search: {
          search_docs: {
            channelPolicy: "enabled",
          },
        },
      },
    });
  });
});
