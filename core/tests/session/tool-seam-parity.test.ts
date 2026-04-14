import { readFileSync } from "node:fs";

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

function createBaseRequest(searchExecuteSpy: ReturnType<typeof vi.fn>) {
  const workspaceExecute = vi.fn(async (_input: unknown, options: ToolExecutionOptions) => ({
    toolCallId: options.toolCallId,
    experimentalContext: options.experimental_context,
  }));

  return {
    request: {
      runtime: createToolRuntime(),
      hostInput: {
        allowSearch: true,
        allowWorkspace: true,
        workspaceScope: "channel-1",
      },
      toolSettings: {
        enabled: ["search_docs", "workspace_lookup"],
      },
      additionalToolDefinitions: [
        createRegisteredToolDefinition({
          pluginName: "workspace",
          name: "workspace_lookup",
          isSupported: ({ runtime }) => runtime.platform === "discord",
          isAllowed: ({ extensionContext, enabledTools }) => {
            const workspaceContext = extensionContext.workspace as { allow: boolean } | undefined;
            return enabledTools.includes("workspace_lookup") && workspaceContext?.allow === true;
          },
          buildExtensionContext: (hostInput: {
            allowWorkspace: boolean;
            workspaceScope: string;
          }) => ({
            allow: hostInput.allowWorkspace,
            scope: hostInput.workspaceScope,
          }),
          execute: workspaceExecute,
        }),
      ],
    },
    workspaceExecute,
    searchExecuteSpy,
  };
}

describe("runtime/direct tool seam parity", () => {
  it("uses the published plugin-sdk entrypoint across the workspace plugin seam", () => {
    const serviceSource = readFileSync(
      new URL("../../src/services/plugin/service.ts", import.meta.url),
      "utf8",
    );
    const workspacePackageEntrySource = readFileSync(
      new URL("../../../plugins/workspace/src/index.ts", import.meta.url),
      "utf8",
    );
    const workspacePackageToolDefinitionsSource = readFileSync(
      new URL("../../../plugins/workspace/src/tool-definitions.ts", import.meta.url),
      "utf8",
    );

    expect(serviceSource).toContain('from "@yesimbot/plugin-sdk"');
    expect(workspacePackageEntrySource).toContain('from "@yesimbot/plugin-sdk"');
    expect(workspacePackageToolDefinitionsSource).toContain('from "@yesimbot/plugin-sdk"');
    expect(serviceSource).toMatch(/import\s*\{\s*YesImPlugin\s*\}\s*from "@yesimbot\/plugin-sdk";/);
    expect(serviceSource).toMatch(
      /import type\s*\{[\s\S]*IPluginService[\s\S]*RegisteredToolDefinition[\s\S]*ToolAssemblyRequest[\s\S]*ToolInvocationRequest[\s\S]*ToolRuntime[\s\S]*ToolSource[\s\S]*\}\s*from "@yesimbot\/plugin-sdk";/,
    );
    expect(workspacePackageEntrySource).toMatch(
      /import\s*\{\s*Metadata,\s*YesImPlugin\s*\}\s*from "@yesimbot\/plugin-sdk";/,
    );
    expect(workspacePackageToolDefinitionsSource).toMatch(
      /import type\s*\{\s*RegisteredToolDefinition\s*\}\s*from "@yesimbot\/plugin-sdk";/,
    );
    expect(serviceSource).not.toContain("packages/plugin-sdk/src/index");
    expect(workspacePackageEntrySource).not.toContain("packages/plugin-sdk/src/index");
    expect(workspacePackageToolDefinitionsSource).not.toContain("packages/plugin-sdk/src/index");
  });

  it("keeps supportedTools, activeTools, experimentalContext, and execution semantics aligned", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const searchExecuteSpy = vi.fn(async (input: unknown, options: ToolExecutionOptions) => ({
      input,
      toolCallId: options.toolCallId,
      messages: options.messages ?? [],
      experimentalContext: options.experimental_context,
    }));

    await service.install(new SearchFixturePlugin(ctx, searchExecuteSpy));

    const { request } = createBaseRequest(searchExecuteSpy);
    const originalAssembleTools = service.assembleTools.bind(service);
    const invokeAssemblies: Array<Awaited<ReturnType<typeof service.assembleTools>>> = [];

    Object.defineProperty(service, "assembleTools", {
      configurable: true,
      value: vi.fn(async (assemblyRequest: Parameters<typeof service.assembleTools>[0]) => {
        const assembly = await originalAssembleTools(assemblyRequest);
        invokeAssemblies.push(assembly);
        return assembly;
      }),
    });

    const runtimeAssembly = await originalAssembleTools(request);
    const runtimeResult = await runtimeAssembly.activeTools.search_docs?.execute?.(
      { query: "athena" } as never,
      {
        toolCallId: "runtime:search_docs",
        messages: [],
        experimental_context: runtimeAssembly.experimentalContext,
      },
    );
    const directResult = await service.invoke({
      name: "search_docs",
      input: { query: "athena" },
      options: { messages: [] },
      ...request,
    });
    const directAssembly = invokeAssemblies.at(-1);

    expect(directAssembly).toBeTruthy();
    expect(Object.keys(directAssembly!.supportedTools).sort()).toEqual(
      Object.keys(runtimeAssembly.supportedTools).sort(),
    );
    expect(Object.keys(directAssembly!.activeTools).sort()).toEqual(
      Object.keys(runtimeAssembly.activeTools).sort(),
    );
    expect(directAssembly!.experimentalContext).toEqual(runtimeAssembly.experimentalContext);

    expect(runtimeResult).toEqual({
      input: { query: "athena" },
      toolCallId: "runtime:search_docs",
      messages: [],
      experimentalContext: runtimeAssembly.experimentalContext,
    });
    expect(directResult).toMatchObject({
      input: { query: "athena" },
      messages: [],
      experimentalContext: runtimeAssembly.experimentalContext,
    });
    expect((directResult as { toolCallId: string }).toolCallId).toMatch(/^manual:/);
    expect({
      ...(directResult as Record<string, unknown>),
      toolCallId: "runtime:search_docs",
    }).toEqual(runtimeResult);
    expect((directResult as { toolCallId: string }).toolCallId).not.toBe(
      (runtimeResult as { toolCallId: string }).toolCallId,
    );
  });

  it("derives plugin-owned experimentalContext for parity without caller-supplied contextFactories", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const searchExecuteSpy = vi.fn(async (input: unknown, options: ToolExecutionOptions) => ({
      input,
      toolCallId: options.toolCallId,
      experimentalContext: options.experimental_context,
    }));

    await service.install(new SearchFixturePlugin(ctx, searchExecuteSpy));

    const { request } = createBaseRequest(searchExecuteSpy);
    const runtimeAssembly = await service.assembleTools(request);
    const runtimeResult = await runtimeAssembly.activeTools.search_docs?.execute?.(
      { query: "athena" } as never,
      {
        toolCallId: "runtime:search_docs",
        messages: [],
        experimental_context: runtimeAssembly.experimentalContext,
      },
    );
    const directResult = await service.invoke({
      name: "search_docs",
      input: { query: "athena" },
      options: { messages: [] },
      ...request,
    });

    expect(runtimeAssembly.experimentalContext).toEqual({
      "search-fixture": {
        allow: true,
        channelKey: "discord:channel-1",
      },
      workspace: {
        allow: true,
        scope: "channel-1",
      },
    });
    expect(runtimeResult).toMatchObject({
      experimentalContext: runtimeAssembly.experimentalContext,
    });
    expect(directResult).toMatchObject({
      experimentalContext: runtimeAssembly.experimentalContext,
    });
  });

  it("fails on missing required tools with the same message in runtime and direct invocation", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const searchExecuteSpy = vi.fn(async (input: unknown) => input);

    await service.install(new SearchFixturePlugin(ctx, searchExecuteSpy));

    const { request } = createBaseRequest(searchExecuteSpy);
    const parityRequest = {
      ...request,
      toolSettings: {
        enabled: ["workspace_lookup"],
        required: ["search_docs"],
      },
    };

    await expect(service.assembleTools(parityRequest)).rejects.toThrow(
      /tools.required missing active tool: search_docs/i,
    );
    await expect(
      service.invoke({
        name: "workspace_lookup",
        input: {},
        options: {},
        ...parityRequest,
      }),
    ).rejects.toThrow(/tools.required missing active tool: search_docs/i);
  });

  it("fails on reserved tool names with the same message in runtime and direct invocation", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const searchExecuteSpy = vi.fn(async (input: unknown) => input);

    await service.install(new SearchFixturePlugin(ctx, searchExecuteSpy));

    const { request } = createBaseRequest(searchExecuteSpy);
    const parityRequest = {
      ...request,
      additionalToolDefinitions: [
        ...request.additionalToolDefinitions,
        createRegisteredToolDefinition({
          pluginName: "workspace",
          name: "send_message",
        }),
      ],
    };

    await expect(service.assembleTools(parityRequest)).rejects.toThrow(/send_message/i);
    await expect(
      service.invoke({
        name: "workspace_lookup",
        input: {},
        options: {},
        ...parityRequest,
      }),
    ).rejects.toThrow(/send_message/i);
  });

  it("fails on duplicate tool names with the same message in runtime and direct invocation", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const searchExecuteSpy = vi.fn(async (input: unknown) => input);

    await service.install(new SearchFixturePlugin(ctx, searchExecuteSpy));

    const { request } = createBaseRequest(searchExecuteSpy);
    const parityRequest = {
      ...request,
      additionalToolDefinitions: [
        ...request.additionalToolDefinitions,
        createRegisteredToolDefinition({
          pluginName: "workspace",
          name: "search_docs",
        }),
      ],
    };

    await expect(service.assembleTools(parityRequest)).rejects.toThrow(/duplicate.*search_docs/i);
    await expect(
      service.invoke({
        name: "workspace_lookup",
        input: {},
        options: {},
        ...parityRequest,
      }),
    ).rejects.toThrow(/duplicate.*search_docs/i);
  });
});
