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

import {
  Metadata,
  YesImPlugin,
  type RegisteredToolDefinition,
  type ToolExtensionContext,
  type ToolRuntime,
} from "../../../packages/plugin-sdk/src/index";
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

function createRegisteredToolDefinition(options: {
  pluginName: string;
  name: string;
  execute?: (input: unknown, options: ToolExecutionOptions) => Promise<unknown> | unknown;
  isSupported?: RegisteredToolDefinition["definition"]["isSupported"];
  isAllowed?: RegisteredToolDefinition["definition"]["isAllowed"];
  buildExtensionContext?: RegisteredToolDefinition["definition"]["buildExtensionContext"];
}): RegisteredToolDefinition {
  const execute = options.execute ?? (async () => options.name);
  return {
    pluginName: options.pluginName,
    name: options.name,
    definition: {
      name: options.name,
      description: `${options.pluginName}:${options.name}`,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      isSupported: options.isSupported,
      isAllowed: options.isAllowed,
      buildExtensionContext: options.buildExtensionContext,
      execute,
    },
    tool: createAiTool(options.name, execute as AiTool["execute"]),
  };
}

function createPluginService(ctx: Context): PluginService {
  return new PluginService(ctx);
}

@Metadata({ name: "search-fixture", description: "search fixture plugin" })
class SearchFixturePlugin extends YesImPlugin {
  constructor(
    ctx: Context,
    private readonly executeSpy: ReturnType<typeof vi.fn>,
  ) {
    super(ctx);
    this.registerTool({
      name: "search_docs",
      description: "search fixture",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
      isSupported: ({ runtime }) => runtime.platform === "discord",
      isAllowed: ({ extensionContext, enabledTools }) => {
        const searchContext = extensionContext["search-fixture"] as { allow: boolean } | undefined;
        return enabledTools.includes("search_docs") && searchContext?.allow === true;
      },
      buildExtensionContext: (hostInput: { allowSearch: boolean }, runtime: ToolRuntime) => ({
        allow: hostInput.allowSearch,
        channelKey: runtime.channelKey,
      }),
      execute: async (input, options) => await this.executeSpy(input, options),
    });
  }
}

@Metadata({ name: "scoped-fixture", description: "scoped fixture plugin" })
class ScopedFixturePlugin extends YesImPlugin {
  constructor(
    ctx: Context,
    private readonly executeSpy: ReturnType<typeof vi.fn>,
  ) {
    super(ctx);
    this.registerTool({
      name: "scoped_lookup",
      description: "scoped fixture",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      isAllowed: ({ extensionContext, enabledTools }) => {
        const scopedContext = extensionContext["scoped-fixture"] as
          | { allowScoped: boolean }
          | undefined;
        return enabledTools.includes("scoped_lookup") && scopedContext?.allowScoped === true;
      },
      buildExtensionContext: (hostInput: { allowScoped: boolean }) => ({
        allowScoped: hostInput.allowScoped,
      }),
      execute: async (input, options) => await this.executeSpy(input, options),
    });
  }
}

describe("PluginService canonical tool seam", () => {
  it("assembleTools derives buildExtensionContext for global and scoped definitions", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const executeSpy = vi.fn(async (input: unknown) => input);

    await service.install(new SearchFixturePlugin(ctx, executeSpy));
    await service.install(new ScopedFixturePlugin(ctx, executeSpy), {
      scope: "discord:channel-1",
    });

    const assembly = await (
      service as PluginService & {
        assembleTools: (request: unknown) => Promise<{
          supportedTools: Record<string, unknown>;
          activeTools: Record<string, unknown>;
          experimentalContext: ToolExtensionContext;
        }>;
      }
    ).assembleTools({
      runtime: createToolRuntime(),
      hostInput: { allowSearch: true, allowScoped: true },
      scope: "discord:channel-1",
      toolSettings: { enabled: ["search_docs", "scoped_lookup"] },
    });

    expect(Object.keys(assembly.supportedTools)).toEqual([
      "send_message",
      "search_docs",
      "scoped_lookup",
    ]);
    expect(Object.keys(assembly.activeTools)).toEqual([
      "send_message",
      "search_docs",
      "scoped_lookup",
    ]);
    expect(assembly.experimentalContext).toEqual({
      "search-fixture": {
        allow: true,
        channelKey: "discord:channel-1",
      },
      "scoped-fixture": {
        allowScoped: true,
      },
    });
  });

  it("assembleTools still fails fast on reserved and duplicate tool names", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const executeSpy = vi.fn(async (input: unknown) => input);

    await service.install(new SearchFixturePlugin(ctx, executeSpy));

    const assembleTools = (
      service as PluginService & {
        assembleTools: (request: unknown) => Promise<unknown>;
      }
    ).assembleTools.bind(service);

    await expect(
      assembleTools({
        runtime: createToolRuntime(),
        hostInput: {},
        additionalToolDefinitions: [
          createRegisteredToolDefinition({
            pluginName: "manual-source",
            name: "send_message",
          }),
        ],
      }),
    ).rejects.toThrow(/send_message/i);

    await expect(
      assembleTools({
        runtime: createToolRuntime(),
        hostInput: {},
        additionalToolDefinitions: [
          createRegisteredToolDefinition({
            pluginName: "manual-source",
            name: "search_docs",
          }),
        ],
      }),
    ).rejects.toThrow(/duplicate|search_docs/i);
  });

  it("invoke resolves the target tool through assembleTools instead of getToolSet", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const executeSpy = vi.fn(async (input: unknown, options: ToolExecutionOptions) => ({
      input,
      toolCallId: options.toolCallId,
    }));

    const assembleTools = vi.fn(async () => ({
      supportedTools: {
        send_message: createAiTool("send_message"),
        search_docs: createAiTool("search_docs", executeSpy),
      },
      activeTools: {
        send_message: createAiTool("send_message"),
        search_docs: createAiTool("search_docs", executeSpy),
      },
      experimentalContext: {
        "search-fixture": { allow: true },
      },
      signature: '["search_docs","send_message"]',
    }));

    Object.defineProperty(service, "assembleTools", {
      value: assembleTools,
      configurable: true,
    });
    Object.defineProperty(service, "getToolSet", {
      value: vi.fn(() => {
        throw new Error("invoke should not read getToolSet");
      }),
      configurable: true,
    });

    await expect(
      service.invoke({
        name: "search_docs",
        input: { query: "athena" },
        options: { toolCallId: "runtime:search_docs" },
        runtime: createToolRuntime(),
        hostInput: {},
      }),
    ).resolves.toEqual({
      input: { query: "athena" },
      toolCallId: "runtime:search_docs",
    });

    expect(assembleTools).toHaveBeenCalledOnce();
    expect(executeSpy).toHaveBeenCalledOnce();
  });

  it("invoke only diverges from runtime execution on transport metadata such as generated toolCallId", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const seenToolCallIds: string[] = [];
    const executeSpy = vi.fn(async (input: unknown, options: ToolExecutionOptions) => {
      seenToolCallIds.push(options.toolCallId);
      return { ok: true, input };
    });

    await service.install(new SearchFixturePlugin(ctx, executeSpy));

    const assembly = await (
      service as PluginService & {
        assembleTools: (request: unknown) => Promise<{
          activeTools: Record<string, { execute?: AiTool["execute"] }>;
          experimentalContext: ToolExtensionContext;
        }>;
      }
    ).assembleTools({
      runtime: createToolRuntime(),
      hostInput: { allowSearch: true },
      toolSettings: { enabled: ["search_docs"] },
      contextFactories: {
        "search-fixture": (hostInput: { allowSearch: boolean }) => ({
          allow: hostInput.allowSearch,
        }),
      },
    });

    const runtimeResult = await assembly.activeTools.search_docs?.execute?.(
      { query: "athena" } as never,
      {
        toolCallId: "runtime:search_docs",
        messages: [],
        experimental_context: assembly.experimentalContext,
      },
    );
    const manualResult = await service.invoke({
      name: "search_docs",
      input: { query: "athena" },
      options: {},
      runtime: createToolRuntime(),
      hostInput: { allowSearch: true },
      toolSettings: { enabled: ["search_docs"] },
      contextFactories: {
        "search-fixture": (hostInput: { allowSearch: boolean }) => ({
          allow: hostInput.allowSearch,
        }),
      },
    });

    expect(runtimeResult).toEqual({ ok: true, input: { query: "athena" } });
    expect(manualResult).toEqual(runtimeResult);
    expect(seenToolCallIds[0]).toBe("runtime:search_docs");
    expect(seenToolCallIds[1]).toMatch(/^manual:/);
  });

  it("invoke executes using derived buildExtensionContext without manual contextFactories", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const executeSpy = vi.fn(async (input: unknown, options: ToolExecutionOptions) => ({
      input,
      experimentalContext: options.experimental_context,
    }));

    await service.install(new SearchFixturePlugin(ctx, executeSpy));

    await expect(
      service.invoke({
        name: "search_docs",
        input: { query: "athena" },
        options: {},
        runtime: createToolRuntime(),
        hostInput: { allowSearch: true },
        toolSettings: { enabled: ["search_docs"] },
      }),
    ).resolves.toEqual({
      input: { query: "athena" },
      experimentalContext: {
        "search-fixture": {
          allow: true,
          channelKey: "discord:channel-1",
        },
      },
    });
  });
});
