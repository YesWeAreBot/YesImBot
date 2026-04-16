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
  type ResponseContext,
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
    baseDir: "/tmp/athena-tool-gates",
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
    basePath: "/tmp/athena-tool-gates",
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

function createPluginService(ctx: Context): PluginService {
  return new PluginService(ctx);
}

@Metadata({ name: "search", description: "search fixture plugin" })
class SearchFixturePlugin extends YesImPlugin {
  constructor(
    ctx: Context,
    toolName = "search",
    private readonly captures: {
      matchedRuntime?: ToolRuntime;
      enabledContext?: ResponseContext;
    } = {},
  ) {
    super(ctx);
    this.registerTool({
      name: toolName,
      description: "search fixture",
      builtin: false,
      inputSchema: {
        type: "object",
        properties: {},
      },
      match: ({ runtime }) => {
        this.captures.matchedRuntime = runtime;
        return runtime.platform === "discord" && !("authorRoles" in runtime);
      },
      enable: ({ responseContext }) => {
        this.captures.enabledContext = responseContext;
        const searchContext = responseContext.search;

        return searchContext?.channelPolicy === "enabled";
      },
      execute: async () => "ok",
    });
  }
}

type GroupManagementExtension = {
  authorRoles: string[];
  selfRoles: string[];
  manage: {
    kick: boolean;
    ban: boolean;
  };
};

type GroupHostInput = {
  koishiSession: {
    author: { roles: string[] };
    self: { roles: string[] };
    bot: { manage: GroupManagementExtension["manage"] };
  };
};

@Metadata({ name: "group-management", description: "group management fixture plugin" })
class GroupManagementFixturePlugin extends YesImPlugin {
  constructor(ctx: Context) {
    super(ctx);
    this.registerTool({
      name: "group-management",
      description: "group-management fixture",
      builtin: false,
      inputSchema: {
        type: "object",
        properties: {},
      },
      match: ({ runtime }) => runtime.platform === "discord" && !("manage" in runtime),
      enable: ({ responseContext }) => {
        const groupContext = responseContext["group-management"];

        return (
          groupContext?.authorRoles?.includes("admin") === true &&
          groupContext?.selfRoles?.includes("owner") &&
          groupContext?.manage?.kick
        );
      },
      execute: async () => "managed",
    });
  }

  override buildContext<THostInput>(request: { hostInput: THostInput }): Record<string, unknown> {
    const host = request.hostInput as GroupHostInput;
    return {
      authorRoles: [...host.koishiSession.author.roles],
      selfRoles: [...host.koishiSession.self.roles],
      manage: host.koishiSession.bot.manage,
    };
  }
}

describe("explicit tool gate contract", () => {
  it("fails fast when a plugin registers reserved or duplicate tool names like send_message", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);

    await expect(service.install(new SearchFixturePlugin(ctx, "send_message"))).rejects.toThrow(
      /send_message/i,
    );

    await service.install(new SearchFixturePlugin(ctx, "search"));

    await expect(service.install(new SearchFixturePlugin(ctx, "search"))).rejects.toThrow(
      /search/i,
    );
  });

  it("evaluates match against the core-owned ToolRuntime baseline only", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const captures: {
      matchedRuntime?: ToolRuntime;
    } = {};
    const plugin = new SearchFixturePlugin(ctx, "search", captures);

    await service.install(plugin);

    const runtime = createToolRuntime();
    const definition = service.getToolDefinitions().find((tool) => tool.name === "search");

    expect(definition).toBeDefined();
    expect(definition?.definition.match?.({ runtime })).toBe(true);
    expect(captures.matchedRuntime).toEqual(runtime);
    expect(captures.matchedRuntime).not.toHaveProperty("authorRoles");
    expect(captures.matchedRuntime).not.toHaveProperty("selfRoles");
    expect(captures.matchedRuntime).not.toHaveProperty("manage");
  });

  it("evaluates enable from the current ResponseContext only", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const captures: {
      enabledContext?: ResponseContext;
    } = {};
    const plugin = new SearchFixturePlugin(ctx, "search", captures);

    await service.install(plugin);

    const runtime = createToolRuntime();
    const responseContext: ResponseContext = {
      search: {
        channelPolicy: "enabled",
      },
    };
    const definition = service.getToolDefinitions().find((tool) => tool.name === "search");

    expect(definition?.definition.enable?.({ runtime, responseContext: {} })).toBe(false);
    expect(definition?.definition.enable?.({ runtime, responseContext })).toBe(true);
    expect(captures.enabledContext).toEqual(responseContext);
  });

  it("exposes response-scoped gating through the renamed lifecycle contracts", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    await service.install(new SearchFixturePlugin(ctx, "search"));

    const runtime = createToolRuntime();
    const definition = service.getToolDefinitions().find((tool) => tool.name === "search");

    expect(definition?.definition.match?.({ runtime })).toBe(true);
    expect(
      definition?.definition.enable?.({
        runtime,
        responseContext: { search: { channelPolicy: "enabled" } },
      }),
    ).toBe(true);
  });

  it("keeps group-management host fields inside plugin-owned ToolExtensionContext namespaces", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const plugin = new GroupManagementFixturePlugin(ctx);

    await service.install(plugin);

    const runtime = createToolRuntime();
    const responseContext: ResponseContext = {
      "group-management": {
        authorRoles: ["admin"],
        selfRoles: ["owner"],
        manage: {
          kick: true,
          ban: true,
        },
      },
    };
    const definition = service
      .getToolDefinitions()
      .find((tool) => tool.name === "group-management");

    expect(responseContext).toMatchObject({
      "group-management": {
        authorRoles: ["admin"],
        selfRoles: ["owner"],
        manage: {
          kick: true,
          ban: true,
        },
      },
    });
    expect(runtime).not.toHaveProperty("authorRoles");
    expect(runtime).not.toHaveProperty("selfRoles");
    expect(runtime).not.toHaveProperty("manage");
    expect(
      definition?.definition.enable?.({
        runtime,
        responseContext,
      }),
    ).toBe(true);
  });
});
