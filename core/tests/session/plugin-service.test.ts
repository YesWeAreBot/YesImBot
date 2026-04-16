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

function createLifecycleContextMock(): {
  ctx: Context;
  readyHandlers: Array<() => Promise<void>>;
} {
  const readyHandlers: Array<() => Promise<void>> = [];
  const ctx = {
    ...createContextMock(),
    on: vi.fn((event: string, handler: () => Promise<void>) => {
      if (event === "ready") {
        readyHandlers.push(handler);
      }
    }),
  } as unknown as Context;

  return { ctx, readyHandlers };
}

function createImmediateReadyContextMock(): {
  ctx: Context;
  readyTasks: Array<Promise<void>>;
} {
  const readyTasks: Array<Promise<void>> = [];
  const ctx = {
    ...createContextMock(),
    on: vi.fn((event: string, handler: () => Promise<void>) => {
      if (event === "ready") {
        readyTasks.push(handler());
      }
    }),
  } as unknown as Context;

  return { ctx, readyTasks };
}

@Metadata({ name: "concurrent-lifecycle", description: "concurrent lifecycle fixture" })
class ConcurrentLifecyclePlugin extends YesImPlugin {
  constructor(
    ctx: Context,
    private readonly initSpy: ReturnType<typeof vi.fn>,
  ) {
    super(ctx);
  }

  override async init(): Promise<void> {
    await this.initSpy();
  }
}

@Metadata({ name: "constructor-config", description: "constructor config race fixture" })
class ConstructorConfigPlugin extends YesImPlugin {
  private config!: { enableWorkspace: boolean };

  constructor(
    ctx: Context,
    config: { enableWorkspace: boolean },
    private readonly initSpy: ReturnType<typeof vi.fn>,
  ) {
    super(ctx);
    this.config = config;
  }

  override async init(): Promise<void> {
    await this.initSpy(this.config.enableWorkspace);
  }
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
      enable: ({ responseContext }) => {
        const context = responseContext.search as
          | { channelPolicy?: "enabled" | "disabled" }
          | undefined;
        return context?.channelPolicy === "enabled";
      },
      execute: async (input, options) => await this.executeSpy(input, options),
    });
  }

  override buildContext<THostInput>(request: { hostInput: THostInput }): Record<string, unknown> {
    const host = request.hostInput as { allowSearch?: boolean };
    return {
      channelPolicy: host.allowSearch === true ? "enabled" : "disabled",
    };
  }
}

@Metadata({ name: "always-on", description: "always on tool fixture" })
class AlwaysOnPlugin extends YesImPlugin {
  constructor(ctx: Context) {
    super(ctx);
    this.registerTool({
      name: "always_on",
      description: "always on",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      execute: async () => "always-on",
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
  it("defers ready lifecycle until subclass constructor fields are assigned", async () => {
    const { ctx, readyTasks } = createImmediateReadyContextMock();
    const installSpy = vi.fn(async () => undefined);
    const initSpy = vi.fn(async () => undefined);
    (ctx as unknown as { "yesimbot.plugin": { install: typeof installSpy } })["yesimbot.plugin"] = {
      install: installSpy,
    };

    const plugin = new ConstructorConfigPlugin(ctx, { enableWorkspace: true }, initSpy);
    void plugin;

    await expect(Promise.all(readyTasks)).resolves.toEqual([undefined]);
    expect(initSpy).toHaveBeenCalledWith(true);
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(installSpy).toHaveBeenCalledTimes(1);
  });

  it("runs plugin init/install only once under concurrent ready handlers", async () => {
    const { ctx, readyHandlers } = createLifecycleContextMock();
    let releaseInit!: () => void;
    const initGate = new Promise<void>((resolve) => {
      releaseInit = resolve;
    });
    const initSpy = vi.fn(async () => {
      await initGate;
    });
    const installSpy = vi.fn(async () => undefined);
    (ctx as unknown as { "yesimbot.plugin": { install: typeof installSpy } })["yesimbot.plugin"] = {
      install: installSpy,
    };

    const plugin = new ConcurrentLifecyclePlugin(ctx, initSpy);
    void plugin;

    const firstReady = readyHandlers[0]!();
    const secondReady = readyHandlers[0]!();
    releaseInit();
    await Promise.all([firstReady, secondReady]);

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(installSpy).toHaveBeenCalledTimes(1);
  });

  it("compiles one stable catalog per channel key and reuses bound tool handles", async () => {
    const ctx = createContextMock();
    const service = new PluginService(ctx);
    const runtime = createToolRuntime();
    const _sendMessageTool = createAiTool("send_message");

    await service.install(
      new SearchPlugin(
        ctx,
        vi.fn(async () => "search"),
      ),
    );

    const first = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
    });
    const second = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
    });

    expect(first.signature).toBe(second.signature);
    expect(first.tools.search_docs).toBe(second.tools.search_docs);
  });

  it("builds one response context per response start and selects gated tools from the cached catalog", async () => {
    const ctx = createContextMock();
    const service = new PluginService(ctx);
    const runtime = createToolRuntime();
    const _sendMessageTool = createAiTool("send_message");

    await service.install(
      new SearchPlugin(
        ctx,
        vi.fn(async () => "search"),
      ),
    );

    const catalog = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
    });
    const responseContext = await service.buildContext({
      runtime,
      hostInput: { allowSearch: true },
      catalog,
    });
    const selection = await service.selectTools({
      runtime,
      catalog,
      responseContext,
      builtinTools: { send_message: _sendMessageTool },
    });

    expect(Object.keys(selection.activeTools)).toEqual(["send_message", "search_docs"]);
  });

  it("drops tools that fail response-time gating", async () => {
    const ctx = createContextMock();
    const service = new PluginService(ctx);
    const runtime = createToolRuntime();
    const _sendMessageTool = createAiTool("send_message");

    await service.install(
      new SearchPlugin(
        ctx,
        vi.fn(async () => "search"),
      ),
    );

    const catalog = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
    });

    const selection = await service.selectTools({
      runtime,
      catalog,
      responseContext: { search: { channelPolicy: "disabled" } },
      builtinTools: { send_message: _sendMessageTool },
    });

    expect(Object.keys(selection.activeTools)).toEqual(["send_message"]);
  });

  it("keeps tools without enable gating active by default", async () => {
    const ctx = createContextMock();
    const service = new PluginService(ctx);
    const runtime = createToolRuntime();
    const _sendMessageTool = createAiTool("send_message");

    await service.install(new AlwaysOnPlugin(ctx));

    const catalog = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
    });
    const selection = await service.selectTools({
      runtime,
      catalog,
      responseContext: {},
      builtinTools: { send_message: _sendMessageTool },
    });

    expect(Object.keys(selection.activeTools)).toEqual(["send_message", "always_on"]);
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
    const _sendMessageTool = createAiTool("send_message");

    await service.install(
      new SearchPlugin(
        ctx,
        vi.fn(async () => "search"),
      ),
    );

    const first = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
    });

    const scopedPlugin = new ScopedPlugin(ctx);
    await service.install(scopedPlugin, { scope: runtime.channelKey });

    const second = await service.compileTools({
      runtime,
      scope: runtime.channelKey,
    });

    expect(second).not.toBe(first);
    expect(second.signature).toContain("scoped_tool");
    expect(Object.keys(second.tools)).toContain("scoped_tool");
  });

  it("invokes tools through the contextual catalog path", async () => {
    const ctx = createContextMock();
    const service = new PluginService(ctx);
    const runtime = createToolRuntime();
    const _sendMessageTool = createAiTool("send_message");
    const executeSpy = vi.fn(async (input: unknown, options: ToolExecutionOptions) => ({
      input,
      toolCallId: options.toolCallId,
      context: options.experimental_context,
    }));

    await service.install(new SearchPlugin(ctx, executeSpy));
    await service.compileTools({
      runtime,
      scope: runtime.channelKey,
    });

    await expect(
      service.invoke({
        name: "search_docs",
        input: { query: "athena" },
        runtime,
        scope: runtime.channelKey,
        hostInput: { allowSearch: true },
      }),
    ).resolves.toEqual({
      input: { query: "athena" },
      toolCallId: "invoke:search_docs",
      context: {
        search: {
          channelPolicy: "enabled",
        },
      },
    });
  });
});
