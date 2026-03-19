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
  it("delegates ready/dispose lifecycle to PluginService mount/unmount", async () => {
    const lifecycleHandlers = new Map<string, Array<() => void | Promise<void>>>();
    const pluginService = {
      mountPlugin: vi.fn(async () => undefined),
      unmountPlugin: vi.fn(),
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
      "yesimbot.plugin": pluginService,
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

    expect(pluginService.mountPlugin).toHaveBeenCalledWith(plugin);
    expect(pluginService.mountPlugin).toHaveBeenCalledTimes(1);
    expect(registerDir).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();

    for (const handler of lifecycleHandlers.get("dispose") ?? []) {
      await handler();
    }

    expect(pluginService.unmountPlugin).toHaveBeenCalledWith("fixture");
    expect(pluginService.unmountPlugin).toHaveBeenCalledTimes(1);
  });

  it("delegates repeated ready/dispose cycles and leaves idempotency to PluginService", async () => {
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

    const pluginLifecycle = {
      mountPlugin: vi.fn(async () => undefined),
      unmountPlugin: vi.fn(),
    };

    const ctx = {
      on: vi.fn((event: string, handler: () => void | Promise<void>) => {
        const handlers = lifecycleHandlers.get(event) ?? [];
        handlers.push(handler);
        lifecycleHandlers.set(event, handlers);
        return () => true;
      }),
      logger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), level: 2 })),
      "yesimbot.plugin": pluginLifecycle,
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
    expect(pluginLifecycle.mountPlugin).toHaveBeenCalledTimes(2);

    await disposeHandlers[0]?.();
    expect(pluginLifecycle.unmountPlugin).toHaveBeenCalledWith("fixture-2");

    await readyHandlers[0]?.();
    await disposeHandlers[0]?.();

    expect(pluginLifecycle.mountPlugin).toHaveBeenCalledTimes(3);
    expect(pluginLifecycle.unmountPlugin).toHaveBeenCalledTimes(2);
    expect(registerDir).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });
});
