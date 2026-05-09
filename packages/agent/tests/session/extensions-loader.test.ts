import { describe, it, expect, vi } from "vitest";

import { createEventBus } from "../../src/session/event-bus.js";
import { createExtensionBindingSync } from "../../src/session/extensions/loader.js";
import { createExtensionRuntime } from "../../src/session/extensions/loader.js";
import type { ExtensionDefinition } from "../../src/session/extensions/types.js";

describe("createExtensionBindingSync", () => {
  it("should call refreshTools after async setup completes when generation matches", async () => {
    const runtime = createExtensionRuntime();
    const refreshTools = vi.fn();
    runtime.refreshTools = refreshTools;
    const eventBus = createEventBus();

    const def: ExtensionDefinition = {
      id: "test-async",
      setup(api) {
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            api.registerTool({
              name: "async_tool",
              description: "test",
              inputSchema: { type: "object" as const, properties: {} },
              execute: async () => ({ type: "text" as const, value: "ok" }),
            });
            resolve();
          }, 10);
        });
      },
    };

    createExtensionBindingSync(def, 0, runtime, eventBus, () => 0);

    // refreshTools should NOT be called yet (async setup not complete)
    expect(refreshTools).not.toHaveBeenCalled();

    // Wait for async setup to complete
    // registerTool calls refreshTools once, then .then() calls it again (generation check)
    await vi.waitFor(() => {
      expect(refreshTools).toHaveBeenCalledTimes(2);
    });
  });

  it("should NOT call refreshTools from .then() when generation mismatches (stale)", async () => {
    const runtime = createExtensionRuntime();
    const refreshTools = vi.fn();
    runtime.refreshTools = refreshTools;
    const eventBus = createEventBus();

    const def: ExtensionDefinition = {
      id: "test-stale",
      setup() {
        return new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      },
    };

    // Pass generation 0, but getCurrentGeneration returns 1 (simulating a reload)
    createExtensionBindingSync(def, 0, runtime, eventBus, () => 1);

    await new Promise((r) => setTimeout(r, 50));

    // refreshTools should NOT be called from .then() because generation mismatched
    expect(refreshTools).not.toHaveBeenCalled();
  });

  it("should call refreshTools from registerTool but NOT from .then() when generation mismatches", async () => {
    const runtime = createExtensionRuntime();
    const refreshTools = vi.fn();
    runtime.refreshTools = refreshTools;
    const eventBus = createEventBus();

    const def: ExtensionDefinition = {
      id: "test-stale-with-tool",
      setup(api) {
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            // registerTool calls refreshTools once (immediate)
            api.registerTool({
              name: "stale_tool",
              description: "test",
              inputSchema: { type: "object" as const, properties: {} },
              execute: async () => ({ type: "text" as const, value: "ok" }),
            });
            resolve();
          }, 10);
        });
      },
    };

    // generation 0 at creation, but getCurrentGeneration returns 1 (reloaded)
    createExtensionBindingSync(def, 0, runtime, eventBus, () => 1);

    await vi.waitFor(() => {
      expect(refreshTools).toHaveBeenCalledTimes(1);
    });
    // Only 1 call (from registerTool), NOT 2 (the .then() generation check blocks the second)
  });

  it("should call refreshTools synchronously for sync setup that returns cleanup", () => {
    const runtime = createExtensionRuntime();
    const refreshTools = vi.fn();
    runtime.refreshTools = refreshTools;
    const eventBus = createEventBus();

    const def: ExtensionDefinition = {
      id: "test-sync",
      setup() {
        return { dispose() {} };
      },
    };

    // Sync setup with cleanup — refreshTools is NOT called (no .then() path)
    // The existing _refreshToolRegistry in _buildRuntime handles sync tools
    createExtensionBindingSync(def, 0, runtime, eventBus, () => 0);

    // Sync path doesn't call refreshTools (it's handled by _buildRuntime)
    expect(refreshTools).not.toHaveBeenCalled();
  });
});
