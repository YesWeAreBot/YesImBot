import { describe, expect, it, vi } from "vitest";

// Mock koishi to provide a minimal Service base class
vi.mock("koishi", () => {
  class Service {
    ctx: any;
    [Symbol.for("koishi.tracker")]: any;
    constructor(ctx: any, _name: string) {
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

import { HookRunner, type AgentTool } from "@yesimbot/agent/session";

import { ExtensionService } from "../../src/extension/service.js";
import type {
  ExtensionAPI,
  ExtensionDefinition,
  ExtensionHost,
  ExtensionToolSnapshot,
} from "../../src/extension/types.js";
import type { ChannelContext } from "../../src/extension/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createExtensionService() {
  const ctx = {
    on: vi.fn(),
    emit: vi.fn(),
    logger: vi
      .fn()
      .mockReturnValue({ level: 2, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
  return new ExtensionService(ctx as any, {
    basePath: "/tmp/athena-test",
    chatModel: "test-model",
  });
}

function createHost(): ExtensionHost {
  return {
    hostId: "test-host",
    channel: { platform: "test", channelId: "chan", type: "group" },
    hookRunner: new HookRunner(() => ({
      sessionManager: {} as never,
      model: undefined,
      isIdle: () => true,
      signal: undefined,
      abort: () => {},
      hasPendingMessages: () => false,
      getContextUsage: () => undefined,
      compact: () => {},
      getSystemPrompt: () => "",
    })),
    sessionManager: {} as never,
    applyToolState: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendUserMessage: vi.fn().mockResolvedValue(undefined),
    appendEntry: vi.fn(),
    setSessionName: vi.fn(),
    getSessionName: vi.fn().mockReturnValue(undefined),
    getActiveTools: vi.fn().mockReturnValue([]),
    setActiveTools: vi.fn(),
    getModel: vi.fn().mockReturnValue(undefined),
    isIdle: vi.fn().mockReturnValue(true),
    getSignal: vi.fn().mockReturnValue(undefined),
    abort: vi.fn(),
    hasPendingMessages: vi.fn().mockReturnValue(false),
    getContextUsage: vi.fn().mockReturnValue(undefined),
    compact: vi.fn(),
    getSystemPrompt: vi.fn().mockReturnValue(""),
  };
}

function makeContext(overrides?: Partial<ChannelContext>): ChannelContext {
  return {
    platform: "onebot",
    channelId: "123",
    type: "group",
    ...overrides,
  };
}

function makeExtension(
  id: string,
  opts?: { order?: number; setupFn?: (api: ExtensionAPI) => void },
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
      const setup = vi.fn((api: ExtensionAPI) => {
        api.on("agent:start", () => undefined);
      });
      const extension: ExtensionDefinition = { id: "core-owned", setup };
      await service.registerExtension(extension);

      const host = createHost();
      const runtime = await service.createChannelRuntime(
        { platform: "test", channelId: "chan", type: "group" },
        host,
      );

      expect(setup).toHaveBeenCalledTimes(1);
      await runtime.hookRunner.emitLifecycle({ type: "agent:start" });
      expect(runtime.errors).toEqual([]);
    });

    it("collects setup-declared tools and applies an AgentTool snapshot through the host", async () => {
      const service = createExtensionService();
      const execute = vi.fn();
      const tool: AgentTool = {
        description: "Tool from extension",
        inputSchema: undefined,
        execute,
      };
      await service.registerExtension({
        id: "tool-ext",
        setup(api) {
          api.registerTool({ name: "ext_tool", ...tool });
        },
      });

      const host = createHost();
      await service.createChannelRuntime(
        { platform: "test", channelId: "chan", type: "group" },
        host,
      );

      expect(host.applyToolState).toHaveBeenCalledTimes(1);
      const snapshot = vi.mocked(host.applyToolState).mock.calls[0][0] as ExtensionToolSnapshot;
      expect(snapshot.tools.get("ext_tool")).toMatchObject({
        description: "Tool from extension",
      });
      expect(snapshot.activeToolNames).toEqual(["ext_tool"]);
    });

    it("keeps successful extension setup when another extension fails", async () => {
      const service = createExtensionService();
      const goodHandler = vi.fn();
      await service.registerExtension({
        id: "bad",
        setup() {
          throw new Error("setup failed");
        },
      });
      await service.registerExtension({
        id: "good",
        setup(api) {
          api.on("agent:start", goodHandler);
        },
      });

      const host = createHost();
      const runtime = await service.createChannelRuntime(
        { platform: "test", channelId: "chan", type: "group" },
        host,
      );

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
