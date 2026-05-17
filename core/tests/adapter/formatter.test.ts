import { describe, it, expect } from "vitest";

import { createFormatterRegistry } from "../../src/adapter/formatter.js";
import type { AthenaEvent, FormatterContext } from "../../src/adapter/types.js";

function makeEvent(kind: string, actor = "Alice"): AthenaEvent {
  return {
    id: "test-id",
    kind,
    timestamp: Date.now(),
    source: { platform: "onebot", channelId: "123", conversationType: "group" },
    actor: { id: "u1", name: actor },
    details: {},
    meta: { persist: true, triggerCandidate: true },
  };
}

const ctx: FormatterContext = { conversationType: "group", selfId: "bot1" };

describe("FormatterRegistry", () => {
  it("should return null when no formatter is registered for a kind", async () => {
    const registry = createFormatterRegistry();
    const result = await registry.format(makeEvent("unknown_kind"), ctx);
    expect(result).toBeNull();
  });

  it("should call the registered formatter for a matching kind", async () => {
    const registry = createFormatterRegistry();
    registry.register("test_kind", (event) => `formatted: ${event.actor.name}`);
    const result = await registry.format(makeEvent("test_kind"), ctx);
    expect(result).toBe("formatted: Alice");
  });

  it("should allow later registration to override earlier one", async () => {
    const registry = createFormatterRegistry();
    registry.register("test_kind", () => "first");
    registry.register("test_kind", () => "second");
    const result = await registry.format(makeEvent("test_kind"), ctx);
    expect(result).toBe("second");
  });

  it("should restore previous formatter when dispose is called", async () => {
    const registry = createFormatterRegistry();
    registry.register("test_kind", () => "first");
    const dispose = registry.register("test_kind", () => "second");
    dispose();
    const result = await registry.format(makeEvent("test_kind"), ctx);
    expect(result).toBe("first");
  });

  it("should handle async formatters", async () => {
    const registry = createFormatterRegistry();
    registry.register("async_kind", async () => {
      return "async result";
    });
    const result = await registry.format(makeEvent("async_kind"), ctx);
    expect(result).toBe("async result");
  });

  it("should return null when formatter returns null", async () => {
    const registry = createFormatterRegistry();
    registry.register("silent_kind", () => null);
    const result = await registry.format(makeEvent("silent_kind"), ctx);
    expect(result).toBeNull();
  });
});
