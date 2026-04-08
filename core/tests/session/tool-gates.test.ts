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

@Metadata({ name: "search-fixture", description: "search fixture plugin" })
class SearchFixturePlugin extends YesImPlugin {
  constructor(
    ctx: Context,
    toolName = "search",
    private readonly captures: {
      supportedRuntime?: ToolRuntime;
      allowedContext?: ToolExtensionContext;
      enabledTools?: string[];
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
      isSupported: ({ runtime }) => {
        this.captures.supportedRuntime = runtime;
        return runtime.platform === "discord" && !("authorRoles" in runtime);
      },
      isAllowed: ({ extensionContext, enabledTools }) => {
        this.captures.allowedContext = extensionContext;
        this.captures.enabledTools = [...enabledTools];
        const searchContext = extensionContext.search as
          | { channelPolicy?: "enabled" | "disabled" }
          | undefined;

        return enabledTools.includes(toolName) && searchContext?.channelPolicy === "enabled";
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

@Metadata({ name: "group-management-fixture", description: "group management fixture plugin" })
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
      isSupported: ({ runtime }) => runtime.platform === "discord" && !("manage" in runtime),
      isAllowed: ({ extensionContext, enabledTools }) => {
        const groupContext = extensionContext["group-management"] as
          | GroupManagementExtension
          | undefined;

        return (
          enabledTools.includes("group-management") &&
          groupContext?.authorRoles.includes("admin") === true &&
          groupContext.selfRoles.includes("owner") &&
          groupContext.manage.kick
        );
      },
      execute: async () => "managed",
    });
  }

  public createExtensionContext(hostInput: GroupHostInput): ToolExtensionContext {
    return {
      "group-management": {
        authorRoles: [...hostInput.koishiSession.author.roles],
        selfRoles: [...hostInput.koishiSession.self.roles],
        manage: hostInput.koishiSession.bot.manage,
      },
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

  it("evaluates isSupported against the core-owned ToolRuntime baseline only", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const captures: {
      supportedRuntime?: ToolRuntime;
    } = {};
    const plugin = new SearchFixturePlugin(ctx, "search", captures);

    await service.install(plugin);

    const runtime = createToolRuntime();
    const definition = service.getToolDefinitions().find((tool) => tool.name === "search");

    expect(definition).toBeDefined();
    expect(definition?.definition.isSupported?.({ runtime })).toBe(true);
    expect(captures.supportedRuntime).toEqual(runtime);
    expect(captures.supportedRuntime).not.toHaveProperty("authorRoles");
    expect(captures.supportedRuntime).not.toHaveProperty("selfRoles");
    expect(captures.supportedRuntime).not.toHaveProperty("manage");
  });

  it("evaluates isAllowed from the current turn ToolExtensionContext plus enabledTools", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const captures: {
      allowedContext?: ToolExtensionContext;
      enabledTools?: string[];
    } = {};
    const plugin = new SearchFixturePlugin(ctx, "search", captures);

    await service.install(plugin);

    const runtime = createToolRuntime();
    const extensionContext: ToolExtensionContext = {
      search: { channelPolicy: "enabled" },
    };
    const definition = service.getToolDefinitions().find((tool) => tool.name === "search");

    expect(
      definition?.definition.isAllowed?.({ runtime, extensionContext, enabledTools: [] }),
    ).toBe(false);
    expect(
      definition?.definition.isAllowed?.({
        runtime,
        extensionContext,
        enabledTools: ["search"],
      }),
    ).toBe(true);
    expect(captures.allowedContext).toEqual(extensionContext);
    expect(captures.enabledTools).toEqual(["search"]);
  });

  it("keeps group-management host fields inside plugin-owned ToolExtensionContext namespaces", async () => {
    const ctx = createContextMock();
    const service = createPluginService(ctx);
    const plugin = new GroupManagementFixturePlugin(ctx);

    await service.install(plugin);

    const runtime = createToolRuntime();
    const extensionContext = plugin.createExtensionContext({
      koishiSession: {
        author: { roles: ["admin"] },
        self: { roles: ["owner"] },
        bot: {
          manage: {
            kick: true,
            ban: true,
          },
        },
      },
    });
    const definition = service
      .getToolDefinitions()
      .find((tool) => tool.name === "group-management");

    expect(extensionContext).toMatchObject({
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
      definition?.definition.isAllowed?.({
        runtime,
        extensionContext,
        enabledTools: ["group-management"],
      }),
    ).toBe(true);
  });
});
