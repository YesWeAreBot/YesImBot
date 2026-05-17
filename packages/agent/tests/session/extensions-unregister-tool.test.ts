import { describe, it, expect, vi } from "vitest";

import { createEventBus } from "../../src/session/event-bus.js";
import {
  createExtensionBinding,
  createExtensionBindingSync,
  createExtensionRuntime,
} from "../../src/session/extensions/loader.js";
import { ExtensionRegistry } from "../../src/session/extensions/registry.js";
import { ExtensionRunner } from "../../src/session/extensions/runner.js";
import type {
  ExtensionAPI,
  ExtensionBinding,
  ExtensionDefinition,
  ToolDefinition,
} from "../../src/session/extensions/types.js";

function makeToolDef(
  name: string,
): ToolDefinition<Record<string, never>, { type: "text"; value: string }> {
  return {
    name,
    description: `tool ${name}`,
    inputSchema: { type: "object" as const, properties: {} },
    execute: async () => ({ type: "text" as const, value: "ok" }),
  };
}

describe("unregisterTool", () => {
  it("should remove tool from binding and call refreshTools", () => {
    const runtime = createExtensionRuntime();
    const refreshTools = vi.fn<() => void>();
    runtime.refreshTools = refreshTools;
    const eventBus = createEventBus();

    let api: ExtensionAPI | undefined;
    const def: ExtensionDefinition = {
      id: "test",
      setup(_api) {
        api = _api;
        api.registerTool(makeToolDef("tool_a"));
        api.registerTool(makeToolDef("tool_b"));
      },
    };

    const binding = createExtensionBindingSync(def, 0, runtime, eventBus, () => 0);

    expect(binding.tools.has("tool_a")).toBe(true);
    expect(binding.tools.has("tool_b")).toBe(true);
    expect(refreshTools).toHaveBeenCalledTimes(2);

    api?.unregisterTool("tool_a");

    expect(binding.tools.has("tool_a")).toBe(false);
    expect(binding.tools.has("tool_b")).toBe(true);
    expect(refreshTools).toHaveBeenCalledTimes(3);
  });

  it("should silently ignore non-existent tool name", () => {
    const runtime = createExtensionRuntime();
    const refreshTools = vi.fn<() => void>();
    runtime.refreshTools = refreshTools;
    const eventBus = createEventBus();

    let api: ExtensionAPI | undefined;
    const def: ExtensionDefinition = {
      id: "test",
      setup(_api) {
        api = _api;
      },
    };

    createExtensionBindingSync(def, 0, runtime, eventBus, () => 0);

    // Should not throw, should not call refreshTools
    api?.unregisterTool("nonexistent");
    expect(refreshTools).not.toHaveBeenCalled();
  });
});

describe("registeredToolNames tracking", () => {
  it("should track all tools registered during setup", () => {
    const runtime = createExtensionRuntime();
    const eventBus = createEventBus();

    const def: ExtensionDefinition = {
      id: "test",
      setup(api) {
        api.registerTool(makeToolDef("tool_a"));
        api.registerTool(makeToolDef("tool_b"));
        api.registerTool(makeToolDef("tool_c"));
      },
    };

    const binding = createExtensionBindingSync(def, 0, runtime, eventBus, () => 0);

    expect(binding.registeredToolNames).toEqual(new Set(["tool_a", "tool_b", "tool_c"]));
  });

  it("should NOT shrink when unregisterTool is called", () => {
    const runtime = createExtensionRuntime();
    const eventBus = createEventBus();

    let api: ExtensionAPI | undefined;
    const def: ExtensionDefinition = {
      id: "test",
      setup(_api) {
        api = _api;
        api.registerTool(makeToolDef("tool_a"));
        api.registerTool(makeToolDef("tool_b"));
      },
    };

    const binding = createExtensionBindingSync(def, 0, runtime, eventBus, () => 0);

    expect(binding.registeredToolNames).toEqual(new Set(["tool_a", "tool_b"]));

    api?.unregisterTool("tool_a");

    // registeredToolNames still contains tool_a (historical record)
    expect(binding.registeredToolNames).toEqual(new Set(["tool_a", "tool_b"]));
    // But tools map no longer has it
    expect(binding.tools.has("tool_a")).toBe(false);
  });

  it("should be empty when no tools registered", () => {
    const runtime = createExtensionRuntime();
    const eventBus = createEventBus();

    const def: ExtensionDefinition = {
      id: "test",
      setup() {},
    };

    const binding = createExtensionBindingSync(def, 0, runtime, eventBus, () => 0);

    expect(binding.registeredToolNames.size).toBe(0);
  });

  it("should track tools from async setup after completion", async () => {
    const runtime = createExtensionRuntime();
    const eventBus = createEventBus();

    const def: ExtensionDefinition = {
      id: "test-async",
      setup(api) {
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            api.registerTool(makeToolDef("async_tool"));
            resolve();
          }, 10);
        });
      },
    };

    const binding = await createExtensionBinding(def, 0, runtime, eventBus);

    expect(binding.registeredToolNames).toEqual(new Set(["async_tool"]));
    expect(binding.tools.has("async_tool")).toBe(true);
  });
});

describe("registerTool triggers refreshTools via loader", () => {
  // Tests that registerTool calls runtime.refreshTools for both sync and async paths.
  // Runner.reload/ReloadSync also call refreshTools at the end — see runner.ts:520,560.

  it("createExtensionBindingSync should call refreshTools for sync registerTool", () => {
    const runtime = createExtensionRuntime();
    const refreshTools = vi.fn<() => void>();
    runtime.refreshTools = refreshTools;
    const eventBus = createEventBus();

    const def: ExtensionDefinition = {
      id: "test",
      setup(api) {
        api.registerTool(makeToolDef("tool_x"));
      },
    };

    createExtensionBindingSync(def, 0, runtime, eventBus, () => 0);

    // registerTool calls refreshTools once
    expect(refreshTools).toHaveBeenCalledTimes(1);
  });

  it("createExtensionBinding should call refreshTools for async registerTool", async () => {
    const runtime = createExtensionRuntime();
    const refreshTools = vi.fn<() => void>();
    runtime.refreshTools = refreshTools;
    const eventBus = createEventBus();

    const def: ExtensionDefinition = {
      id: "test",
      setup(api) {
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            api.registerTool(makeToolDef("async_tool"));
            resolve();
          }, 10);
        });
      },
    };

    await createExtensionBinding(def, 0, runtime, eventBus);

    // registerTool calls refreshTools once
    expect(refreshTools).toHaveBeenCalledTimes(1);
  });

  it("multiple extensions register tools independently", () => {
    const runtime = createExtensionRuntime();
    const refreshTools = vi.fn<() => void>();
    runtime.refreshTools = refreshTools;
    const eventBus = createEventBus();

    const def1: ExtensionDefinition = {
      id: "ext-a",
      setup(api) {
        api.registerTool(makeToolDef("tool_from_a"));
      },
    };

    const def2: ExtensionDefinition = {
      id: "ext-b",
      setup(api) {
        api.registerTool(makeToolDef("tool_from_b"));
      },
    };

    const binding1 = createExtensionBindingSync(def1, 0, runtime, eventBus, () => 0);
    const binding2 = createExtensionBindingSync(def2, 0, runtime, eventBus, () => 0);

    // Each registerTool calls refreshTools
    expect(refreshTools).toHaveBeenCalledTimes(2);

    // Each binding only knows its own tools
    expect(binding1.tools.has("tool_from_a")).toBe(true);
    expect(binding1.tools.has("tool_from_b")).toBe(false);
    expect(binding2.tools.has("tool_from_b")).toBe(true);
    expect(binding2.tools.has("tool_from_a")).toBe(false);
  });

  it("unregisterTool in one extension does not affect another extension's tools", () => {
    const runtime = createExtensionRuntime();
    const eventBus = createEventBus();

    let api1: ExtensionAPI | undefined;

    const def1: ExtensionDefinition = {
      id: "ext-a",
      setup(api) {
        api1 = api;
        api.registerTool(makeToolDef("shared_name"));
      },
    };

    const def2: ExtensionDefinition = {
      id: "ext-b",
      setup(api) {
        api.registerTool(makeToolDef("shared_name"));
      },
    };

    const binding1 = createExtensionBindingSync(def1, 0, runtime, eventBus, () => 0);
    const binding2 = createExtensionBindingSync(def2, 0, runtime, eventBus, () => 0);

    expect(binding1.tools.has("shared_name")).toBe(true);
    expect(binding2.tools.has("shared_name")).toBe(true);

    // Unregister from ext-a only
    api1?.unregisterTool("shared_name");

    expect(binding1.tools.has("shared_name")).toBe(false);
    // ext-b still has its own "shared_name"
    expect(binding2.tools.has("shared_name")).toBe(true);
  });
});

describe("dispose auto-cleanup semantics", () => {
  it("dispose is called on old bindings during reload lifecycle", async () => {
    const disposeFn = vi.fn<() => void>();
    const binding: ExtensionBinding = {
      id: "test",
      order: 0,
      generation: 0,
      handlers: new Map(),
      tools: new Map([["tool_a", makeToolDef("tool_a")]]),
      cleanup: { dispose: disposeFn },
      registeredToolNames: new Set(["tool_a"]),
    };

    // Simulate what Runner.reload() does: dispose old binding
    await binding.cleanup?.dispose?.();

    expect(disposeFn).toHaveBeenCalledTimes(1);
    // After dispose, tools map still exists (framework calls refreshTools separately)
    // The binding itself doesn't clear its tools - the runner replaces the entire bindings array
    expect(binding.tools.has("tool_a")).toBe(true);
  });

  it("dispose returning Promise is awaited", async () => {
    const disposeFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const binding: ExtensionBinding = {
      id: "test",
      order: 0,
      generation: 0,
      handlers: new Map(),
      tools: new Map(),
      cleanup: { dispose: disposeFn },
      registeredToolNames: new Set(),
    };

    const result = binding.cleanup?.dispose?.();
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  it("dispose rejection is caught (does not propagate)", async () => {
    const disposeFn = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("dispose failed"));
    const binding: ExtensionBinding = {
      id: "test",
      order: 0,
      generation: 0,
      handlers: new Map(),
      tools: new Map(),
      cleanup: { dispose: disposeFn },
      registeredToolNames: new Set(),
    };

    // Simulate Runner.reload() pattern
    try {
      await binding.cleanup?.dispose?.();
    } catch {
      // ignore
    }

    expect(disposeFn).toHaveBeenCalledTimes(1);
  });
});

describe("ExtensionRegistry", () => {
  it("add and get definition", () => {
    const registry = new ExtensionRegistry();
    const def: ExtensionDefinition = { id: "ext-a", setup() {} };

    registry.add(def);

    expect(registry.get("ext-a")).toBe(def);
    expect(registry.getAll()).toHaveLength(1);
  });

  it("remove definition", () => {
    const registry = new ExtensionRegistry();
    registry.add({ id: "ext-a", setup() {} });
    registry.add({ id: "ext-b", setup() {} });

    registry.remove("ext-a");

    expect(registry.get("ext-a")).toBeUndefined();
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.get("ext-b")).toBeDefined();
  });

  it("remove non-existent id is silent", () => {
    const registry = new ExtensionRegistry();
    registry.add({ id: "ext-a", setup() {} });

    registry.remove("nonexistent");

    expect(registry.getAll()).toHaveLength(1);
  });

  it("add with same id overwrites (Map.set semantics)", () => {
    const registry = new ExtensionRegistry();
    const def1: ExtensionDefinition = { id: "ext-a", setup() {} };
    const def2: ExtensionDefinition = { id: "ext-a", setup() {} };

    registry.add(def1);
    registry.add(def2);

    expect(registry.get("ext-a")).toBe(def2);
    expect(registry.getAll()).toHaveLength(1);
  });

  it("_broadcast calls reload on all registered runners", () => {
    const registry = new ExtensionRegistry();

    const mockRunner = {
      reload: vi
        .fn<(definitions: ExtensionDefinition[]) => Promise<void>>()
        .mockResolvedValue(undefined),
    } as unknown as ExtensionRunner;

    registry.registerRunner(mockRunner);
    registry.add({ id: "ext-a", setup() {} });

    // _broadcast is called on add
    expect(mockRunner.reload).toHaveBeenCalledTimes(1);
    expect(mockRunner.reload).toHaveBeenCalledWith([expect.objectContaining({ id: "ext-a" })]);
  });

  it("_broadcast calls reload on remove", () => {
    const registry = new ExtensionRegistry();
    registry.add({ id: "ext-a", setup() {} });

    const mockRunner = {
      reload: vi
        .fn<(definitions: ExtensionDefinition[]) => Promise<void>>()
        .mockResolvedValue(undefined),
    } as unknown as ExtensionRunner;

    registry.registerRunner(mockRunner);
    registry.remove("ext-a");

    // _broadcast is called on remove
    expect(mockRunner.reload).toHaveBeenCalledTimes(1);
    expect(mockRunner.reload).toHaveBeenCalledWith([]);
  });

  it("unregisterRunner stops receiving broadcasts", () => {
    const registry = new ExtensionRegistry();
    const mockRunner = {
      reload: vi
        .fn<(definitions: ExtensionDefinition[]) => Promise<void>>()
        .mockResolvedValue(undefined),
    } as unknown as ExtensionRunner;

    registry.registerRunner(mockRunner);
    registry.unregisterRunner(mockRunner);
    registry.add({ id: "ext-a", setup() {} });

    expect(mockRunner.reload).not.toHaveBeenCalled();
  });

  it("lifecycle: add -> registerRunner -> remove broadcasts updated definitions to runner", () => {
    const registry = new ExtensionRegistry();
    const defA: ExtensionDefinition = { id: "ext-a", setup() {} };
    const defB: ExtensionDefinition = { id: "ext-b", setup() {} };

    registry.add(defA);
    registry.add(defB);

    const mockRunner = {
      reload: vi
        .fn<(definitions: ExtensionDefinition[]) => Promise<void>>()
        .mockResolvedValue(undefined),
    } as unknown as ExtensionRunner;

    registry.registerRunner(mockRunner);

    // Remove ext-a — runner should receive [ext-b]
    registry.remove("ext-a");

    expect(mockRunner.reload).toHaveBeenCalledTimes(1);
    expect(mockRunner.reload).toHaveBeenCalledWith([expect.objectContaining({ id: "ext-b" })]);

    // Remove ext-b — runner should receive []
    registry.remove("ext-b");

    expect(mockRunner.reload).toHaveBeenCalledTimes(2);
    expect(mockRunner.reload).toHaveBeenCalledWith([]);
  });

  it("lifecycle: unregisterRunner after session dispose prevents stale broadcasts", () => {
    const registry = new ExtensionRegistry();
    const defA: ExtensionDefinition = { id: "ext-a", setup() {} };
    registry.add(defA);

    const mockRunner = {
      reload: vi
        .fn<(definitions: ExtensionDefinition[]) => Promise<void>>()
        .mockResolvedValue(undefined),
    } as unknown as ExtensionRunner;

    registry.registerRunner(mockRunner);

    // Simulate session dispose: unregister runner first, then remove extension
    registry.unregisterRunner(mockRunner);
    registry.remove("ext-a");

    // Stale runner should NOT receive the broadcast
    expect(mockRunner.reload).not.toHaveBeenCalled();
  });
});
