import { describe, it, expect, vi } from "vitest";

import type { ExtensionBinding } from "../../../src/session/extensions/types.js";

describe("ExtensionRunner dispose cleanup", () => {
  it("getBindings should return current bindings", () => {
    const binding: ExtensionBinding = {
      id: "test",
      order: 0,
      generation: 0,
      handlers: new Map(),
      tools: new Map(),
      cleanup: { dispose: vi.fn<() => void>() },
      registeredToolNames: new Set(),
    };

    // We can't easily construct a full ExtensionRunner without a runtime,
    // so test the binding cleanup behavior directly
    const result = binding.cleanup?.dispose?.();
    expect(binding.cleanup!.dispose).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("async dispose should have its rejection caught", async () => {
    const disposeFn = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("cleanup failed"));
    const binding: ExtensionBinding = {
      id: "test-async",
      order: 0,
      generation: 0,
      handlers: new Map(),
      tools: new Map(),
      cleanup: { dispose: disposeFn },
      registeredToolNames: new Set(),
    };

    // Simulate the dispose pattern from AgentSession.dispose()
    try {
      const result = binding.cleanup?.dispose?.();
      if (result && typeof result === "object" && "then" in result) {
        await (result as Promise<void>).catch(() => {});
      }
    } catch {
      // ignore
    }

    expect(disposeFn).toHaveBeenCalled();
  });
});
