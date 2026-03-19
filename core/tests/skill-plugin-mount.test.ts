import { describe, expect, it, vi } from "vitest";

import { Metadata } from "../src/services/plugin/decorators";
import { YesImPlugin } from "../src/services/plugin/plugin";

type SkillDef = {
  name: string;
  description: string;
  guidance: string;
  rootDir: string;
  source: "plugin" | "file";
};

describe("plugin metadata skill-pack mounting", () => {
  it("mounts metadata skillPacks on ready and disposes on dispose", async () => {
    const lifecycleHandlers = new Map<string, Array<() => void | Promise<void>>>();
    const pluginRegistry = {
      registerPlugin: vi.fn(),
      unregisterPlugin: vi.fn(),
    };

    const register = vi.fn((def: SkillDef) => {
      const dispose = vi.fn();
      return dispose;
    });

    const registerDir = vi.fn((_dir: string, source: "plugin" | "file") => {
      const defs: SkillDef[] = [
        {
          name: "search",
          description: "search",
          guidance: "search guidance",
          rootDir: "/mock/skills/search",
          source,
        },
        {
          name: "fetch",
          description: "fetch",
          guidance: "fetch guidance",
          rootDir: "/mock/skills/fetch",
          source,
        },
      ];
      return defs.map((def) => register(def));
    });

    const ctx = {
      on: vi.fn((event: string, handler: () => void | Promise<void>) => {
        const handlers = lifecycleHandlers.get(event) ?? [];
        handlers.push(handler);
        lifecycleHandlers.set(event, handlers);
        return () => true;
      }),
      logger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), level: 2 })),
      "yesimbot.plugin": pluginRegistry,
      "yesimbot.skill": {
        register,
        registerDir,
      },
      "yesimbot.hook": {
        registerFromDecorators: vi.fn(),
      },
    } as never;

    @Metadata({
      name: "fixture",
      description: "fixture",
      skillPacks: ["/mock/skills"],
    })
    class FixturePlugin extends YesImPlugin {}

    const plugin = new FixturePlugin(ctx);

    for (const handler of lifecycleHandlers.get("ready") ?? []) {
      await handler();
    }

    expect(pluginRegistry.registerPlugin).toHaveBeenCalledWith(plugin);
    expect(registerDir).toHaveBeenCalledWith("/mock/skills", "plugin");
    expect(register).toHaveBeenCalledTimes(2);
    expect(register.mock.calls[0]?.[0]).toMatchObject({ source: "plugin" });

    for (const handler of lifecycleHandlers.get("dispose") ?? []) {
      await handler();
    }

    const disposers = register.mock.results.map((result) => result.value as ReturnType<typeof vi.fn>);
    for (const dispose of disposers) {
      expect(dispose).toHaveBeenCalledTimes(1);
    }
    expect(pluginRegistry.unregisterPlugin).toHaveBeenCalledWith("fixture");
  });

  it("does not leak duplicate registrations across repeated ready/dispose", async () => {
    const lifecycleHandlers = new Map<string, Array<() => void | Promise<void>>>();
    const register = vi.fn((_def: SkillDef) => vi.fn());
    const registerDir = vi.fn((_dir: string, source: "plugin" | "file") => {
      const defs: SkillDef[] = [
        {
          name: "search",
          description: "search",
          guidance: "search guidance",
          rootDir: "/mock/skills/search",
          source,
        },
      ];
      return defs.map((def) => register(def));
    });

    const ctx = {
      on: vi.fn((event: string, handler: () => void | Promise<void>) => {
        const handlers = lifecycleHandlers.get(event) ?? [];
        handlers.push(handler);
        lifecycleHandlers.set(event, handlers);
        return () => true;
      }),
      logger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), level: 2 })),
      "yesimbot.plugin": {
        registerPlugin: vi.fn(),
        unregisterPlugin: vi.fn(),
      },
      "yesimbot.skill": {
        register,
        registerDir,
      },
      "yesimbot.hook": {
        registerFromDecorators: vi.fn(),
      },
    } as never;

    @Metadata({
      name: "fixture-2",
      description: "fixture-2",
      skillPacks: ["/mock/skills"],
    })
    class FixturePlugin extends YesImPlugin {}

    new FixturePlugin(ctx);

    const readyHandlers = lifecycleHandlers.get("ready") ?? [];
    const disposeHandlers = lifecycleHandlers.get("dispose") ?? [];

    await readyHandlers[0]?.();
    await readyHandlers[0]?.();
    expect(register).toHaveBeenCalledTimes(1);

    await disposeHandlers[0]?.();
    const firstCycleDisposer = register.mock.results[0]?.value as ReturnType<typeof vi.fn>;
    expect(firstCycleDisposer).toHaveBeenCalledTimes(1);

    await readyHandlers[0]?.();
    expect(register).toHaveBeenCalledTimes(2);
  });
});
