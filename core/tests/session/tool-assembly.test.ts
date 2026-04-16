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
    baseDir: "/tmp/athena-tool-assembly",
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
    basePath: "/tmp/athena-tool-assembly",
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

@Metadata({ name: "search", description: "search fixture plugin" })
class SearchPlugin extends YesImPlugin {
  constructor(ctx: Context) {
    super(ctx);
    this.registerTool({
      name: "search",
      description: "search docs",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      match: ({ runtime }) => runtime.platform === "discord",
      enable: ({ responseContext }) => {
        const context = responseContext.search as
          | { channelPolicy?: "enabled" | "disabled" }
          | undefined;
        return context?.channelPolicy === "enabled";
      },
      execute: async () => "search",
    });
  }

  override buildContext(): Record<string, unknown> {
    return { channelPolicy: "enabled" };
  }
}

describe("PluginService tool lifecycle", () => {
  it("keeps compiled catalog tools stable while response selection remains dynamic", async () => {
    const ctx = createContextMock();
    const service = new PluginService(ctx);
    const runtime = createToolRuntime();
    const sendMessageTool = createAiTool("send_message");

    await service.install(new SearchPlugin(ctx));

    const catalog = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
    });
    const enabled = await service.selectTools({
      runtime,
      scope: runtime.channelKey,
      catalog,
      responseContext: { search: { channelPolicy: "enabled" } },
      builtinTools: { send_message: sendMessageTool },
    });

    expect(Object.keys(catalog.tools)).toContain("search");
    expect(Object.keys(enabled.activeTools)).toContain("search");
  });
});
