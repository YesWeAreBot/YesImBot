import { describe, expect, it, vi } from "vitest";

import { PluginService } from "../src/services/plugin/service";
import type { HookService } from "../src/services/hook/service";
import { FunctionType, type ToolExecutionContext } from "../src/services/plugin/types";
import type { YesImPlugin } from "../src/services/plugin/plugin";

function createPluginServiceHarness(params?: {
  registerFromDecorators?: (ctx: unknown, instance: object) => Array<() => void>;
  registerDir?: (dir: string, source: "plugin" | "file") => Array<() => void>;
}) {
  const hookRegister =
    params?.registerFromDecorators ??
    (() => {
      return [];
    });
  const skillRegisterDir =
    params?.registerDir ??
    (() => {
      return [];
    });

  const service = {
    ctx: {
      "yesimbot.hook": {
        registerFromDecorators: hookRegister,
      },
      "yesimbot.skill": {
        registerDir: skillRegisterDir,
      },
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      level: 2,
    },
    plugins: new Map<string, YesImPlugin>(),
    capabilityResolvers: [],
    mountRecords: new Map<string, unknown>(),
    registerPlugin: PluginService.prototype.registerPlugin,
    unregisterPlugin: PluginService.prototype.unregisterPlugin,
    mountPlugin: PluginService.prototype.mountPlugin,
    unmountPlugin: PluginService.prototype.unmountPlugin,
    getDefinition: PluginService.prototype.getDefinition,
    getTools: PluginService.prototype.getTools,
    getRoundAvailability: PluginService.prototype.getRoundAvailability,
    findFunction: (PluginService.prototype as unknown as { findFunction: unknown }).findFunction,
    listPlugins: PluginService.prototype.listPlugins,
  } as unknown as PluginService;

  return service;
}

function createPlugin(name: string, skillPacks: string[] = ["/skills"]): YesImPlugin {
  return {
    metadata: {
      name,
      description: name,
      skillPacks,
    },
    getFunctions: () => new Map(),
  } as unknown as YesImPlugin;
}

describe("plugin bundle coordination", () => {
  it("mounts plugin bundles atomically", async () => {
    const mountOrder: string[] = [];
    const service = createPluginServiceHarness({
      registerFromDecorators: () => {
        mountOrder.push("hooks");
        return [vi.fn()];
      },
      registerDir: () => {
        mountOrder.push("skills");
        return [vi.fn()];
      },
    });

    const plugin = createPlugin("fixture");
    await service.mountPlugin(plugin);
    mountOrder.push("visible");

    expect(mountOrder).toEqual(["hooks", "skills", "visible"]);
    expect(service.listPlugins()).toContain("fixture");
  });

  it("rolls back hook and skill registrations on mount failure", async () => {
    const rollbacks: string[] = [];
    const service = createPluginServiceHarness({
      registerFromDecorators: () => [
        vi.fn(() => {
          rollbacks.push("hook");
        }),
      ],
      registerDir: (dir) => {
        if (dir === "/skills-b") {
          throw new Error("skill pack mount failed");
        }
        return [
          vi.fn(() => {
            rollbacks.push("skill");
          }),
        ];
      },
    });

    const plugin = createPlugin("fixture", ["/skills-a", "/skills-b"]);
    await expect(service.mountPlugin(plugin)).rejects.toThrow("skill pack mount failed");

    expect(rollbacks).toEqual(["skill", "hook"]);
    expect(service.listPlugins()).not.toContain("fixture");
  });

  it("keeps plugins invisible until bundle mount succeeds", async () => {
    let shouldFail = true;
    const service = createPluginServiceHarness({
      registerFromDecorators: () => {
        if (shouldFail) {
          throw new Error("hook mount failed");
        }
        return [];
      },
    });
    const plugin = createPlugin("fixture");

    await expect(service.mountPlugin(plugin)).rejects.toThrow("hook mount failed");
    expect(service.listPlugins()).not.toContain("fixture");

    shouldFail = false;
    await service.mountPlugin(plugin);
    expect(service.listPlugins()).toContain("fixture");
  });

  it("returns per-round visible and unavailable tool decisions", () => {
    const service = createPluginServiceHarness();
    const plugin = {
      metadata: {
        name: "coordination",
        description: "coordination",
        skillPacks: [],
      },
      getFunctions: () =>
        new Map([
          [
            "public_tool",
            {
              name: "public_tool",
              description: "Public tool",
              type: FunctionType.Tool,
              parameters: {},
              handler: vi.fn(),
            },
          ],
          [
            "search",
            {
              name: "search",
              description: "Hidden search",
              type: FunctionType.Tool,
              hidden: true,
              requiredCapabilities: ["message.read_history"],
              onCapabilityMissing: "hint" as const,
              parameters: {},
              handler: vi.fn(),
            },
          ],
        ]),
    } as unknown as YesImPlugin;

    service.registerPlugin(plugin);

    const toolCtx: ToolExecutionContext = {
      platform: "onebot",
      channelId: "c1",
      capabilities: { core: {}, extended: {} },
    };

    const decision = service.getRoundAvailability(toolCtx, ["search", "missing_tool"]);

    expect(decision.visible.map((entry) => entry.function.name)).toEqual(["public_tool"]);
    expect(decision.unavailable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "search",
          reason: "capability-missing",
          detail: "capabilities missing: message.read_history",
        }),
        expect.objectContaining({
          name: "missing_tool",
          reason: "tool-not-installed",
          detail: "tool not installed",
        }),
      ]),
    );
  });

  it("executes tool calls in parallel with hook runtime and actions sequentially", async () => {
    const callOrder: string[] = [];
    let runningTools = 0;
    let maxConcurrentTools = 0;
    const released: Record<string, () => void> = {};

    const hookService = {
      executeBefore: vi.fn(async (_type: unknown, params: Record<string, unknown>) => {
        callOrder.push(`before:${String(params.marker)}`);
        return { skipped: false, params };
      }),
      executeAfter: vi.fn(async (_type: unknown, params: Record<string, unknown>) => {
        callOrder.push(`after:${String(params.marker)}`);
      }),
      executeError: vi.fn(async (_type: unknown, params: Record<string, unknown>) => {
        callOrder.push(`error:${String(params.marker)}`);
      }),
    } as unknown as HookService;

    const service = {
      ctx: {
        "yesimbot.hook": hookService,
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        level: 2,
      },
      plugins: new Map(),
      capabilityResolvers: [],
      mountRecords: new Map(),
      registerPlugin: PluginService.prototype.registerPlugin,
      getDefinition: PluginService.prototype.getDefinition,
      invoke: PluginService.prototype.invoke,
      executeRoundActions: (PluginService.prototype as unknown as { executeRoundActions: unknown })
        .executeRoundActions,
      findFunction: (PluginService.prototype as unknown as { findFunction: unknown }).findFunction,
    } as unknown as PluginService;

    const plugin = {
      metadata: {
        name: "coordination",
        description: "coordination",
        skillPacks: [],
      },
      getFunctions: () =>
        new Map([
          [
            "tool_a",
            {
              name: "tool_a",
              description: "Tool A",
              type: FunctionType.Tool,
              parameters: {},
              handler: vi.fn((params: Record<string, unknown>) => {
                callOrder.push("invoke:tool_a");
                runningTools += 1;
                maxConcurrentTools = Math.max(maxConcurrentTools, runningTools);
                return new Promise((resolve) => {
                  released.tool_a = () => {
                    runningTools -= 1;
                    resolve({ ok: true, data: String(params.marker) });
                  };
                });
              }),
            },
          ],
          [
            "tool_b",
            {
              name: "tool_b",
              description: "Tool B",
              type: FunctionType.Tool,
              parameters: {},
              handler: vi.fn((params: Record<string, unknown>) => {
                callOrder.push("invoke:tool_b");
                runningTools += 1;
                maxConcurrentTools = Math.max(maxConcurrentTools, runningTools);
                return new Promise((resolve) => {
                  released.tool_b = () => {
                    runningTools -= 1;
                    resolve({ ok: true, data: String(params.marker) });
                  };
                });
              }),
            },
          ],
          [
            "action_a",
            {
              name: "action_a",
              description: "Action A",
              type: FunctionType.Action,
              parameters: {},
              handler: vi.fn(async (params: Record<string, unknown>) => {
                callOrder.push("invoke:action_a");
                return { ok: true, data: String(params.marker) };
              }),
            },
          ],
          [
            "action_b",
            {
              name: "action_b",
              description: "Action B",
              type: FunctionType.Action,
              parameters: {},
              handler: vi.fn(async (params: Record<string, unknown>) => {
                callOrder.push("invoke:action_b");
                return { ok: true, data: String(params.marker) };
              }),
            },
          ],
        ]),
    } as unknown as YesImPlugin;

    service.registerPlugin(plugin);

    const execPromise = (
      service as unknown as {
        executeRoundActions: (
          actions: Array<{ name: string; params?: Record<string, unknown> }>,
          ctx: ToolExecutionContext,
          traceId: string,
          maxResultLength: number,
        ) => Promise<{ toolResults: unknown[]; hasToolCalls: boolean; hasActionCalls: boolean }>;
      }
    ).executeRoundActions(
      [
        { name: "tool_a", params: { marker: "tool_a" } },
        { name: "action_a", params: { marker: "action_a" } },
        { name: "tool_b", params: { marker: "tool_b" } },
        { name: "action_b", params: { marker: "action_b" } },
      ],
      {
        platform: "onebot",
        channelId: "c1",
        capabilities: { core: {}, extended: {} },
      },
      "trace-1",
      512,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maxConcurrentTools).toBe(2);
    expect(callOrder).not.toContain("invoke:action_a");

    released.tool_a?.();
    released.tool_b?.();
    const results = await execPromise;

    expect(results.hasToolCalls).toBe(true);
    expect(results.hasActionCalls).toBe(true);
    expect(hookService.executeBefore).toHaveBeenCalledTimes(2);
    expect(hookService.executeAfter).toHaveBeenCalledTimes(2);
    expect(hookService.executeError).not.toHaveBeenCalled();
    expect(callOrder.indexOf("invoke:action_a")).toBeLessThan(callOrder.indexOf("invoke:action_b"));
  });
});
