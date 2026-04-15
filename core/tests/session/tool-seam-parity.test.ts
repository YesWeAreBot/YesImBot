import type { Tool as AiTool } from "@ai-sdk/provider-utils";
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
    baseDir: "/tmp/athena-tool-seam-parity",
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
    basePath: "/tmp/athena-tool-seam-parity",
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

function createAiTool(label: string): AiTool {
  return {
    description: `${label} tool`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    execute: vi.fn(async () => label),
  } as unknown as AiTool;
}

@Metadata({ name: "search", description: "search seam fixture plugin" })
class SearchFixturePlugin extends YesImPlugin {
  constructor(ctx: Context) {
    super(ctx);
    this.registerTool({
      name: "search",
      description: "search fixture",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      match: ({ runtime }) => runtime.platform === "discord",
      extendResponse: () => ({ channelPolicy: "enabled" }),
      enable: ({ responseContext }) => {
        const policy = responseContext.search?.search?.channelPolicy;
        return policy === "enabled";
      },
      execute: async () => "search",
    });
  }
}

describe("runtime tool seam parity", () => {
  it("compiles catalogs and selects response tools without calling a standalone assembly helper", async () => {
    const ctx = createContextMock();
    const service = new PluginService(ctx);
    const runtime = createToolRuntime();
    const sendMessageTool = createAiTool("send_message");

    await service.install(new SearchFixturePlugin(ctx));

    const catalog = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
      hostInput: {},
      sendMessageTool,
    });
    const responseContext = await service.buildResponseContext({
      runtime,
      scope: runtime.channelKey,
      hostInput: {},
      catalog,
    });

    const selection = await service.selectTools({
      runtime,
      scope: runtime.channelKey,
      catalog,
      responseContext,
    });

    expect(Object.keys(catalog.tools)).toContain("send_message");
    expect(selection.activeToolNames).toContain("send_message");
  });

  it("keeps compiled catalog tools stable while response selection remains dynamic", async () => {
    const ctx = createContextMock();
    const service = new PluginService(ctx);
    const runtime = createToolRuntime();
    const sendMessageTool = createAiTool("send_message");

    await service.install(new SearchFixturePlugin(ctx));

    const catalog = await service.compileTools({
      runtime,
      hostInput: {},
      scope: runtime.channelKey,
      sendMessageTool,
    });
    const enabled = await service.selectTools({
      runtime,
      scope: runtime.channelKey,
      catalog,
      responseContext: { search: { search: { channelPolicy: "enabled" } } },
    });

    expect(Object.keys(catalog.tools)).toContain("search");
    expect(Object.keys(enabled.activeTools)).toContain("search");
  });
});
