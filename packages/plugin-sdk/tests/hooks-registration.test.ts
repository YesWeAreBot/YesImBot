import { describe, expect, it, vi } from "vitest";

vi.mock("koishi-plugin-yesimbot/services/hook/decorators", () => ({
  Hook: vi.fn(() => () => undefined),
}));

vi.mock("koishi-plugin-yesimbot/services/hook/types", () => ({
  HookPhase: { Before: "before", After: "after", Error: "error" },
  HookType: { Tool: "tool", Agent: "agent" },
}));

describe("plugin-sdk hook registration", () => {
  it("keeps decorator-first class authoring as the primary path", async () => {
    const { Hook, HookPhase, HookType } = await import("../src/hooks/index");

    class DecoratorFirstExample {
      @Hook({ type: HookType.Tool, phase: HookPhase.Before })
      async beforeTool() {
        return { modified: false as const };
      }
    }

    const plugin = new DecoratorFirstExample();
    expect(plugin).toBeInstanceOf(DecoratorFirstExample);
  });

  it("forwards registerHook() to runtime hook service", async () => {
    const { HookPhase, HookType, registerHook } = await import("../src/hooks/index");

    const dispose = vi.fn();
    const register = vi.fn(() => dispose);
    const ctx = {
      "yesimbot.hook": {
        register,
      },
    };

    const def = {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: vi.fn(async () => ({ modified: false as const })),
    };

    const returnedDispose = registerHook(ctx as never, def);

    expect(register).toHaveBeenCalledWith(ctx, def);
    expect(returnedDispose).toBe(dispose);
  });
});
