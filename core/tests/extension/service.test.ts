import { describe, expect, it, vi, beforeEach } from "vitest";

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

import { ExtensionRunner, HookRunner } from "@yesimbot/agent/session";

import { ExtensionService } from "../../src/extension/service.js";
import type { AthenaExtensionDefinition, ChannelContext } from "../../src/extension/types.js";

// ---------------------------------------------------------------------------
// Spy setup — spy on the real ExtensionRunner prototype
// ---------------------------------------------------------------------------

let reloadSpy: ReturnType<typeof vi.spyOn>;
let onErrorSpy: ReturnType<typeof vi.spyOn>;
let getBindingsSpy: ReturnType<typeof vi.spyOn>;
let invalidateSpy: ReturnType<typeof vi.spyOn>;
let setHookRunnerSpy: ReturnType<typeof vi.spyOn>;

function setupSpies() {
  reloadSpy = vi.spyOn(ExtensionRunner.prototype, "reload").mockResolvedValue(undefined);
  onErrorSpy = vi.spyOn(ExtensionRunner.prototype, "onError").mockReturnValue(() => {});
  getBindingsSpy = vi.spyOn(ExtensionRunner.prototype, "getBindings").mockReturnValue([]);
  invalidateSpy = vi.spyOn(ExtensionRunner.prototype, "invalidate").mockImplementation(() => {});
  setHookRunnerSpy = vi
    .spyOn(ExtensionRunner.prototype, "setHookRunner")
    .mockImplementation(() => {});
}

function restoreSpies() {
  reloadSpy?.mockRestore();
  onErrorSpy?.mockRestore();
  getBindingsSpy?.mockRestore();
  invalidateSpy?.mockRestore();
  setHookRunnerSpy?.mockRestore();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCtx() {
  return {
    on: vi.fn(),
    emit: vi.fn(),
    logger: vi
      .fn()
      .mockReturnValue({ level: 2, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
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
  opts?: { order?: number; setupFn?: () => void },
): AthenaExtensionDefinition {
  return {
    id,
    order: opts?.order,
    setup: opts?.setupFn ?? vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExtensionService", () => {
  let ctx: ReturnType<typeof createMockCtx>;
  let service: ExtensionService;

  beforeEach(() => {
    setupSpies();
    ctx = createMockCtx();
    service = new ExtensionService(ctx as any, {
      basePath: "/tmp/athena-test",
      chatModel: "test-model",
    });
  });

  // ==========================================================================
  // Registration
  // ==========================================================================

  describe("registerExtension", () => {
    it("stores the extension definition and returns ReloadSummary", async () => {
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
      const v1 = makeExtension("ext-a");
      const v2 = makeExtension("ext-a");
      await service.registerExtension(v1);
      await service.registerExtension(v2);

      expect(service.getExtension("ext-a")).toBe(v2);
    });

    it("triggers reload for all existing channel runtimes", async () => {
      await service.createChannelRuntime(makeContext());
      await service.registerExtension(makeExtension("ext-b"));

      // reload called: 1 for createChannelRuntime + 1 for register
      expect(reloadSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("unregisterExtension", () => {
    it("removes the extension and returns summary", async () => {
      await service.registerExtension(makeExtension("ext-a"));
      const summary = await service.unregisterExtension("ext-a");

      expect(service.getExtension("ext-a")).toBeUndefined();
      expect(summary).toMatchObject({ allSucceeded: true });
    });

    it("returns empty summary for unknown id (no-op)", async () => {
      const summary = await service.unregisterExtension("nonexistent");

      expect(summary).toMatchObject({
        totalChannels: 0,
        successCount: 0,
        failureCount: 0,
        allSucceeded: true,
      });
    });

    it("triggers reload for all existing channel runtimes", async () => {
      await service.registerExtension(makeExtension("ext-a"));
      await service.createChannelRuntime(makeContext());
      await service.unregisterExtension("ext-a");

      // 1 from register + 1 from createChannelRuntime + 1 from unregister
      expect(reloadSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe("getAllDefinitions", () => {
    it("returns all registered definitions", async () => {
      await service.registerExtension(makeExtension("a"));
      await service.registerExtension(makeExtension("b"));

      const defs = service.getAllDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs.map((d) => d.id)).toEqual(expect.arrayContaining(["a", "b"]));
    });

    it("returns empty array when nothing registered", () => {
      expect(service.getAllDefinitions()).toEqual([]);
    });
  });

  // ==========================================================================
  // Channel Runtime Lifecycle
  // ==========================================================================

  describe("createChannelRuntime", () => {
    it("creates a runtime with a HookRunner and ExtensionRunner", async () => {
      const runtime = await service.createChannelRuntime(makeContext());

      expect(runtime).toMatchObject({
        channelKey: "onebot:123",
        hookRunner: expect.any(HookRunner),
        extensionRunner: expect.any(ExtensionRunner),
        errors: [],
      });
      expect(runtime.toolSnapshot).toBeDefined();
      expect(runtime.toolSnapshot.tools).toBeInstanceOf(Map);
    });

    it("disposes existing runtime before creating a new one for the same channel", async () => {
      const spy = vi.spyOn(service, "disposeChannelRuntime");

      await service.createChannelRuntime(makeContext());
      await service.createChannelRuntime(makeContext());

      // Second call should dispose first
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("calls reload with global definitions", async () => {
      await service.registerExtension(makeExtension("ext-a"));
      await service.registerExtension(makeExtension("ext-b"));

      await service.createChannelRuntime(makeContext());

      // The last reload call should have the definitions
      expect(reloadSpy).toHaveBeenCalled();
      const lastCall = reloadSpy.mock.calls[reloadSpy.mock.calls.length - 1];
      const definitions = lastCall[0];
      expect(definitions).toHaveLength(2);
      expect(definitions.map((d: any) => d.id)).toEqual(expect.arrayContaining(["ext-a", "ext-b"]));
    });

    it("includes additionalExtensions in the reload call", async () => {
      const additional = [{ id: "per-channel-ext", setup: vi.fn() }];
      await service.createChannelRuntime(makeContext(), additional as any);

      expect(reloadSpy).toHaveBeenCalled();
      const definitions = reloadSpy.mock.calls[0][0];
      expect(definitions).toHaveLength(1);
      expect(definitions[0].id).toBe("per-channel-ext");
    });

    it("wires error listener on the runner", async () => {
      await service.createChannelRuntime(makeContext());

      expect(onErrorSpy).toHaveBeenCalled();
    });

    it("captures errors from setup into ChannelRuntimeError[]", async () => {
      // Capture the error listener that onError wires
      let errorCapture: ((err: any) => void) | undefined;
      onErrorSpy.mockImplementation((listener: any) => {
        errorCapture = listener;
        return () => {};
      });

      // Make reload emit an error through the captured listener
      reloadSpy.mockImplementation(async () => {
        errorCapture?.({
          event: "setup",
          error: "Extension setup failed",
          stack: "Error stack",
        });
      });

      const runtime = await service.createChannelRuntime(makeContext());

      expect(runtime.errors).toHaveLength(1);
      expect(runtime.errors[0]).toMatchObject({
        extensionId: "setup",
        error: "Extension setup failed",
      });
    });
  });

  describe("disposeChannelRuntime", () => {
    it("calls all cleanups and removes the channel", async () => {
      const cleanup1 = vi.fn();
      const cleanup2 = vi.fn();

      await service.createChannelRuntime(makeContext());

      // Inject cleanups via internal state
      const state = (service as any).channels.get("onebot:123");
      state.cleanups.push(cleanup1, cleanup2);

      await service.disposeChannelRuntime(makeContext());

      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
      expect(service.getChannelRuntime(makeContext())).toBeUndefined();
    });

    it("continues calling remaining cleanups when one throws", async () => {
      const cleanup1 = vi.fn().mockRejectedValue(new Error("cleanup boom"));
      const cleanup2 = vi.fn();

      await service.createChannelRuntime(makeContext());
      const state = (service as any).channels.get("onebot:123");
      state.cleanups.push(cleanup1, cleanup2);

      await service.disposeChannelRuntime(makeContext());

      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
    });

    it("calls runner.invalidate on dispose", async () => {
      await service.createChannelRuntime(makeContext());

      await service.disposeChannelRuntime(makeContext());

      expect(invalidateSpy).toHaveBeenCalledWith("Channel runtime disposed");
    });

    it("is a no-op when channel does not exist", async () => {
      // Should not throw
      await service.disposeChannelRuntime(makeContext());
    });
  });

  describe("getChannelRuntime", () => {
    it("returns the runtime for an existing channel", async () => {
      await service.createChannelRuntime(makeContext());
      const runtime = service.getChannelRuntime(makeContext());

      expect(runtime).toBeDefined();
      expect(runtime!.channelKey).toBe("onebot:123");
    });

    it("returns undefined for a channel that doesn't exist", () => {
      expect(service.getChannelRuntime(makeContext())).toBeUndefined();
    });
  });

  // ==========================================================================
  // Multi-channel reload aggregation
  // ==========================================================================

  describe("multi-channel reload aggregation", () => {
    it("aggregates results from multiple channels on register", async () => {
      const ctx1 = makeContext({ platform: "onebot", channelId: "1" });
      const ctx2 = makeContext({ platform: "onebot", channelId: "2" });
      const ctx3 = makeContext({ platform: "discord", channelId: "3" });

      await service.createChannelRuntime(ctx1);
      await service.createChannelRuntime(ctx2);
      await service.createChannelRuntime(ctx3);

      const summary = await service.registerExtension(makeExtension("ext-x"));

      expect(summary.totalChannels).toBe(3);
      expect(summary.successCount).toBe(3);
      expect(summary.failureCount).toBe(0);
      expect(summary.allSucceeded).toBe(true);
      expect(summary.results).toHaveLength(3);
    });

    it("reports partial failures without rolling back global definition", async () => {
      const ctx1 = makeContext({ platform: "onebot", channelId: "1" });
      const ctx2 = makeContext({ platform: "onebot", channelId: "2" });

      await service.createChannelRuntime(ctx1);
      await service.createChannelRuntime(ctx2);

      // 4th call (register reload for channel 2) fails
      let callCount = 0;
      reloadSpy.mockImplementation(async () => {
        callCount++;
        if (callCount === 4) throw new Error("Channel 2 reload failed");
      });

      const summary = await service.registerExtension(makeExtension("ext-y"));

      // ext-y still in global registry despite partial failure
      expect(service.getExtension("ext-y")).toBeDefined();

      expect(summary.totalChannels).toBe(2);
      expect(summary.successCount).toBe(1);
      expect(summary.failureCount).toBe(1);
      expect(summary.allSucceeded).toBe(false);
    });

    it("one channel failure does not block other channels", async () => {
      const ctx1 = makeContext({ platform: "onebot", channelId: "1" });
      const ctx2 = makeContext({ platform: "onebot", channelId: "2" });

      await service.createChannelRuntime(ctx1);
      await service.createChannelRuntime(ctx2);

      // 3rd call (register reload for channel 1) fails
      let callCount = 0;
      reloadSpy.mockImplementation(async () => {
        callCount++;
        if (callCount === 3) throw new Error("Channel 1 exploded");
      });

      const summary = await service.registerExtension(makeExtension("ext-z"));

      expect(summary.totalChannels).toBe(2);
      expect(summary.results).toHaveLength(2);
      expect(summary.results[0].success).toBe(false);
      expect(summary.results[1].success).toBe(true);
    });
  });

  // ==========================================================================
  // No rollback on partial failure
  // ==========================================================================

  describe("no rollback on partial failure", () => {
    it("global definition persists even when all channel reloads fail", async () => {
      const ctx1 = makeContext({ platform: "onebot", channelId: "1" });

      await service.createChannelRuntime(ctx1);

      reloadSpy.mockRejectedValue(new Error("reload boom"));

      const ext = makeExtension("ext-persistent");
      const summary = await service.registerExtension(ext);

      expect(service.getExtension("ext-persistent")).toBe(ext);
      expect(summary.allSucceeded).toBe(false);
    });

    it("unregister removes definition even if channel reload fails", async () => {
      await service.registerExtension(makeExtension("ext-fail"));

      await service.createChannelRuntime(makeContext());

      reloadSpy.mockRejectedValue(new Error("boom"));
      const summary = await service.unregisterExtension("ext-fail");

      expect(service.getExtension("ext-fail")).toBeUndefined();
      expect(summary.allSucceeded).toBe(false);
    });
  });

  // ==========================================================================
  // Tool Snapshot
  // ==========================================================================

  describe("buildToolSnapshot", () => {
    it("returns empty snapshot for unknown channel", () => {
      const snapshot = service.buildToolSnapshot(makeContext());

      expect(snapshot.tools).toBeInstanceOf(Map);
      expect(snapshot.tools.size).toBe(0);
      expect(snapshot.activeToolNames).toEqual([]);
    });

    it("collects tools from extension bindings", async () => {
      const tool1 = { name: "tool-a", description: "A", parameters: {} };
      const tool2 = { name: "tool-b", description: "B", parameters: {} };

      getBindingsSpy.mockReturnValue([
        {
          tools: new Map([
            ["tool-a", tool1],
            ["tool-b", tool2],
          ]),
        },
      ]);

      await service.createChannelRuntime(makeContext());
      const snapshot = service.buildToolSnapshot(makeContext());

      expect(snapshot.tools.size).toBe(2);
      expect(snapshot.tools.get("tool-a")).toBe(tool1);
      expect(snapshot.tools.get("tool-b")).toBe(tool2);
      expect(snapshot.activeToolNames).toEqual(expect.arrayContaining(["tool-a", "tool-b"]));
    });

    it("collects tools from multiple bindings", async () => {
      getBindingsSpy.mockReturnValue([
        { tools: new Map([["tool-a", { name: "tool-a" }]]) },
        { tools: new Map([["tool-b", { name: "tool-b" }]]) },
      ]);

      await service.createChannelRuntime(makeContext());
      const snapshot = service.buildToolSnapshot(makeContext());

      expect(snapshot.tools.size).toBe(2);
      expect(snapshot.activeToolNames).toHaveLength(2);
    });

    it("later binding's tool overwrites earlier binding's tool with same name", async () => {
      const toolV1 = { name: "shared", description: "v1" };
      const toolV2 = { name: "shared", description: "v2" };

      getBindingsSpy.mockReturnValue([
        { tools: new Map([["shared", toolV1]]) },
        { tools: new Map([["shared", toolV2]]) },
      ]);

      await service.createChannelRuntime(makeContext());
      const snapshot = service.buildToolSnapshot(makeContext());

      expect(snapshot.tools.get("shared")).toBe(toolV2);
    });
  });

  // ==========================================================================
  // Tool snapshot in ChannelRuntime
  // ==========================================================================

  describe("ChannelRuntime.toolSnapshot", () => {
    it("is populated after createChannelRuntime", async () => {
      getBindingsSpy.mockReturnValue([{ tools: new Map([["my-tool", { name: "my-tool" }]]) }]);

      const runtime = await service.createChannelRuntime(makeContext());

      expect(runtime.toolSnapshot.tools.size).toBe(1);
      expect(runtime.toolSnapshot.tools.has("my-tool")).toBe(true);
      expect(runtime.toolSnapshot.activeToolNames).toContain("my-tool");
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe("edge cases", () => {
    it("channelKey uses platform:channelId format", async () => {
      const ctx = makeContext({ platform: "sandbox:abc", channelId: "xyz" });
      await service.createChannelRuntime(ctx);

      const runtime = service.getChannelRuntime(ctx);
      expect(runtime!.channelKey).toBe("sandbox:abc:xyz");
    });

    it("private and group channels with same platform:channelId collide", async () => {
      const group = makeContext({ type: "group" });
      const priv = makeContext({ type: "private" });

      await service.createChannelRuntime(group);
      await service.createChannelRuntime(priv);

      // They share the same platform:channelId key, so private replaces group
      const rt1 = service.getChannelRuntime(group);
      const rt2 = service.getChannelRuntime(priv);
      expect(rt1).toBeDefined();
      expect(rt2).toBeDefined();
    });

    it("dispose is callable from ChannelRuntime", async () => {
      const runtime = await service.createChannelRuntime(makeContext());

      await runtime.dispose();

      expect(service.getChannelRuntime(makeContext())).toBeUndefined();
    });
  });
});
