import { describe, expect, it, vi } from "vitest";

// Mock koishi to provide a minimal Service base class
vi.mock("koishi", () => {
  class Service {
    ctx: unknown;
    [Symbol.for("koishi.tracker")]: unknown;
    constructor(ctx: unknown, _name: string) {
      this.ctx = ctx;
    }
    protected start() {}
    protected stop() {}
  }
  return {
    Context: class {},
    Service,
    Logger: class {},
  };
});

import type { SessionManager } from "@yesimbot/agent/session";
import { HookRunner, type AgentTool } from "@yesimbot/agent/session";

import { ExtensionService } from "../../src/extension/service.js";
import type {
  Channel,
  ExtensionContext,
  ExtensionDefinition,
  ExtensionToolSnapshot,
} from "../../src/extension/types.js";

type MockLogger = {
  level: number;
  info: () => void;
  warn: () => void;
  error: () => void;
  debug: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createExtensionService() {
  const logger: MockLogger = {
    level: 2,
    info: vi.fn<() => void>(),
    warn: vi.fn<() => void>(),
    error: vi.fn<() => void>(),
    debug: vi.fn<() => void>(),
  };
  const ctx = {
    on: vi.fn<(event: string, handler: (...args: unknown[]) => unknown) => void>(),
    emit: vi.fn<(event: string, ...args: unknown[]) => void>(),
    logger: vi.fn<(name: string) => MockLogger>().mockReturnValue(logger),
  };
  return new ExtensionService(ctx as never, {
    basePath: "/tmp/athena-test",
    chatModel: "test-model",
  });
}

function makeChannel(overrides?: Partial<Channel>): Channel {
  return {
    platform: "onebot",
    channelId: "123",
    type: "group",
    ...overrides,
  };
}

function createRuntimeOptions(overrides?: Partial<Channel>) {
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
    channel: makeChannel(overrides),
    hookRunner,
    sessionManager: {} as SessionManager,
    applyToolState: vi.fn<(snapshot: ExtensionToolSnapshot) => void>(),
    sendMessage: vi
      .fn<(message: unknown, options?: unknown) => Promise<void>>()
      .mockResolvedValue(undefined),
    sendUserMessage: vi
      .fn<(content: unknown, options?: unknown) => Promise<void>>()
      .mockResolvedValue(undefined),
    appendEntry: vi.fn<(customType: string, data?: unknown) => void>(),
    setSessionName: vi.fn<(name: string) => void>(),
    getSessionName: vi.fn<() => string | undefined>().mockReturnValue(undefined),
    getActiveTools: vi.fn<() => string[]>().mockReturnValue([]),
    setActiveTools: vi.fn<(toolNames: string[]) => void>(),
  };
}

function makeExtension(
  id: string,
  opts?: { order?: number; setupFn?: (ctx: ExtensionContext) => void },
): ExtensionDefinition {
  return {
    id,
    order: opts?.order,
    setup: opts?.setupFn ?? (() => {}),
  };
}

// ---------------------------------------------------------------------------
// Tests — boundary tests proving the target API
// ---------------------------------------------------------------------------

describe("ExtensionService", () => {
  // ==========================================================================
  // Core-owned extension lifecycle
  // ==========================================================================

  describe("core-owned extension lifecycle", () => {
    it("sets up extensions through core-owned bindings", async () => {
      const service = createExtensionService();
      const setup = vi.fn<(ctx: ExtensionContext) => void>((ctx) => {
        ctx.on("agent:start", () => undefined);
      });
      const extension: ExtensionDefinition = { id: "core-owned", setup };
      await service.registerExtension(extension);

      const options = createRuntimeOptions({
        platform: "test",
        channelId: "chan",
        type: "group",
      });
      const runtime = await service.createChannelRuntime(options);

      expect(setup).toHaveBeenCalledTimes(1);
      await runtime.hookRunner.emitLifecycle({ type: "agent:start" });
      expect(runtime.errors).toEqual([]);
    });

    it("passes Koishi channel context including bot to extension setup", async () => {
      const service = createExtensionService();
      const bot = { selfId: "bot-001", user: { name: "Athena" } };
      const seen: Array<ExtensionContext["channel"]> = [];

      await service.registerExtension({
        id: "channel-ext",
        setup(ctx) {
          seen.push(ctx.channel);
        },
      });

      await service.createChannelRuntime(createRuntimeOptions({ bot: bot as never }));

      expect(seen).toEqual([
        expect.objectContaining({
          platform: "onebot",
          channelId: "123",
          type: "group",
          bot,
        }),
      ]);
    });

    it("collects setup-declared tools and applies an AgentTool snapshot through the host", async () => {
      const service = createExtensionService();
      const execute = vi.fn<() => void>();
      const tool: AgentTool = {
        description: "Tool from extension",
        inputSchema: undefined,
        execute,
      };
      await service.registerExtension({
        id: "tool-ext",
        setup(ctx) {
          ctx.registerTool({ name: "ext_tool", ...tool });
        },
      });

      const options = createRuntimeOptions({
        platform: "test",
        channelId: "chan",
        type: "group",
      });
      await service.createChannelRuntime(options);

      expect(options.applyToolState).toHaveBeenCalledTimes(1);
      const snapshot = vi.mocked(options.applyToolState).mock.calls[0][0] as ExtensionToolSnapshot;
      expect(snapshot.tools.get("ext_tool")).toMatchObject({
        description: "Tool from extension",
      });
      expect(snapshot.activeToolNames).toEqual(["ext_tool"]);
    });

    it("keeps successful extension setup when another extension fails", async () => {
      const service = createExtensionService();
      const goodHandler = vi.fn<() => void>();
      await service.registerExtension({
        id: "bad",
        setup() {
          throw new Error("setup failed");
        },
      });
      await service.registerExtension({
        id: "good",
        setup(ctx) {
          ctx.on("agent:start", goodHandler);
        },
      });

      const options = createRuntimeOptions({
        platform: "test",
        channelId: "chan",
        type: "group",
      });
      const runtime = await service.createChannelRuntime(options);

      expect(runtime.errors).toEqual([
        expect.objectContaining({ extensionId: "bad", error: "setup failed" }),
      ]);
      await runtime.hookRunner.emitLifecycle({ type: "agent:start" });
      expect(goodHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Registration (pure, no channel runtimes needed)
  // ==========================================================================

  describe("registerExtension", () => {
    it("stores the extension definition and returns ReloadSummary", async () => {
      const service = createExtensionService();
      const ext = makeExtension("ext-a");
      const summary = await service.registerExtension(ext);

      expect(service.getExtension("ext-a")).toBe(ext);
      expect(summary).toMatchObject({
        totalChannels: 0,
        successCount: 0,
        failureCount: 0,
        allSucceeded: true,
      });
    });

    it("replaces an extension with the same id", async () => {
      const service = createExtensionService();
      const v1 = makeExtension("ext-a");
      const v2 = makeExtension("ext-a");
      await service.registerExtension(v1);
      await service.registerExtension(v2);

      expect(service.getExtension("ext-a")).toBe(v2);
    });
  });

  describe("unregisterExtension", () => {
    it("removes the extension and returns summary", async () => {
      const service = createExtensionService();
      await service.registerExtension(makeExtension("ext-a"));
      const summary = await service.unregisterExtension("ext-a");

      expect(service.getExtension("ext-a")).toBeUndefined();
      expect(summary).toMatchObject({ allSucceeded: true });
    });

    it("returns empty summary for unknown id (no-op)", async () => {
      const service = createExtensionService();
      const summary = await service.unregisterExtension("nonexistent");

      expect(summary).toMatchObject({
        totalChannels: 0,
        successCount: 0,
        failureCount: 0,
        allSucceeded: true,
      });
    });
  });

  describe("getAllDefinitions", () => {
    it("returns all registered definitions", async () => {
      const service = createExtensionService();
      await service.registerExtension(makeExtension("a"));
      await service.registerExtension(makeExtension("b"));

      const defs = service.getAllDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs.map((d) => d.id)).toEqual(expect.arrayContaining(["a", "b"]));
    });

    it("returns empty array when nothing registered", () => {
      const service = createExtensionService();
      expect(service.getAllDefinitions()).toEqual([]);
    });
  });
});
