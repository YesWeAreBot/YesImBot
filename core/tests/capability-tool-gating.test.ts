import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildToolPromptFragments } from "../src/services/agent/tools";
import { PluginService } from "../src/services/plugin/service";
import {
  FunctionType,
  type RoundFunctionEntry,
  type RoundUnavailableEntry,
  type ToolExecutionContext,
} from "../src/services/plugin/types";
import { getCapabilityByKey } from "../src/runtime/contracts";

function createToolCtx(capabilities?: ToolExecutionContext["capabilities"]): ToolExecutionContext {
  return {
    platform: "onebot",
    channelId: "c1",
    capabilities,
  };
}

function createPluginServiceMock(definitions: Record<string, Record<string, unknown>>) {
  const entries = Object.entries(definitions).map(([name, definition]) => ({
    type: "function" as const,
    functionType: (definition.type as FunctionType | undefined) ?? FunctionType.Tool,
    function: {
      name,
      description: String(definition.description ?? name),
      parameters: {},
    },
  }));

  return {
    getRoundAvailability: vi.fn((ctx: ToolExecutionContext, allowedTools?: string[]) => {
      const requested = new Set(allowedTools ?? []);
      const visible: RoundFunctionEntry[] = [];
      const unavailable: RoundUnavailableEntry[] = [];

      for (const entry of entries) {
        const definition = definitions[entry.function.name];
        const isHidden = Boolean(definition?.hidden);
        if (isHidden && !requested.has(entry.function.name)) {
          continue;
        }

        const requiredCapabilities = (definition?.requiredCapabilities as string[] | undefined) ?? [];
        if (requiredCapabilities.length === 0) {
          visible.push(entry);
          continue;
        }

        const missing = requiredCapabilities.filter((key) => {
          const state = getCapabilityByKey(ctx.capabilities, key);
          return !state || state.status !== "available";
        });
        if (missing.length === 0) {
          visible.push(entry);
          continue;
        }

        const onMissing = definition?.onCapabilityMissing;
        if (onMissing === "hint") {
          unavailable.push({
            name: entry.function.name,
            reason: "capability-missing",
            detail: `capabilities missing: ${missing.join(", ")}`,
          });
        }
      }

      if (requested.size) {
        const known = new Set(entries.map((entry) => entry.function.name));
        for (const name of requested) {
          if (!known.has(name)) {
            unavailable.push({
              name,
              reason: "tool-not-installed",
              detail: "tool not installed",
            });
          }
        }
      }

      return { visible, unavailable };
    }),
  };
}

function createPluginServiceHarnessWithUnknownLogger() {
  const service = {
    logger: {
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      level: 2,
    },
    plugins: new Map(),
    capabilityResolvers: [],
    mountRecords: new Map(),
    registerPlugin: PluginService.prototype.registerPlugin,
    getDefinition: PluginService.prototype.getDefinition,
    getTools: PluginService.prototype.getTools,
    getRoundAvailability: PluginService.prototype.getRoundAvailability,
    findFunction: (PluginService.prototype as unknown as { findFunction: unknown }).findFunction,
  } as unknown as PluginService;

  service.registerPlugin({
    metadata: {
      name: "unknown-capability-fixture",
      description: "fixture",
    },
    getFunctions: () =>
      new Map([
        [
          "typo_tool",
          {
            name: "typo_tool",
            description: "typo",
            type: FunctionType.Tool,
            requiredCapabilities: ["typo.key"],
            onCapabilityMissing: "hint",
            parameters: {},
            handler: vi.fn(),
          },
        ],
      ]),
  } as never);

  return service;
}

function createPluginServiceWithHidden(
  visibleDefinitions: Record<string, Record<string, unknown>>,
  hiddenDefinitions: Record<string, Record<string, unknown>>,
) {
  const visibleEntries = Object.entries(visibleDefinitions).map(([name, definition]) => ({
    type: "function" as const,
    functionType: (definition.type as FunctionType | undefined) ?? FunctionType.Tool,
    function: {
      name,
      description: String(definition.description ?? name),
      parameters: {},
    },
  }));
  const hiddenEntries = Object.entries(hiddenDefinitions).map(([name, definition]) => ({
    type: "function" as const,
    functionType: (definition.type as FunctionType | undefined) ?? FunctionType.Tool,
    function: {
      name,
      description: String(definition.description ?? name),
      parameters: {},
    },
  }));

  return {
    getRoundAvailability: vi.fn((_: ToolExecutionContext, allowedTools?: string[]) => {
      const visible: RoundFunctionEntry[] = [...visibleEntries];
      const unavailable: RoundUnavailableEntry[] = [];
      const allowed = new Set(allowedTools ?? []);

      for (const entry of hiddenEntries) {
        if (!allowed.has(entry.function.name)) {
          continue;
        }
        const definition = hiddenDefinitions[entry.function.name] ?? {};
        const required = (definition.requiredCapabilities as string[] | undefined) ?? [];
        if (required.length > 0) {
          unavailable.push({
            name: entry.function.name,
            reason: "capability-missing",
            detail: `capabilities missing: ${required.join(", ")}`,
          });
          continue;
        }
        visible.push(entry);
      }

      return { visible, unavailable };
    }),
  };
}

function buildToolSchemaForPrompt(pluginService: never, toolCtx: ToolExecutionContext): string {
  const fragments = buildToolPromptFragments(pluginService, toolCtx);
  const availableFragment = fragments.find((f) => f.id === "tooling.available");
  return availableFragment?.content ?? "";
}

function buildToolSchemaForPromptWithAllowed(
  pluginService: never,
  toolCtx: ToolExecutionContext,
  allowedTools: string[],
): string {
  const fragments = buildToolPromptFragments(pluginService, toolCtx, allowedTools);
  const availableFragment = fragments.find((f) => f.id === "tooling.available");
  return availableFragment?.content ?? "";
}

describe("capability tool gating", () => {
  const pluginServiceSource = readFileSync(
    path.resolve(__dirname, "../src/services/plugin/service.ts"),
    "utf8",
  );
  const loopSource = readFileSync(path.resolve(__dirname, "../src/services/agent/loop.ts"), "utf8");

  it("includes tools when required capabilities are available", () => {
    const pluginService = createPluginServiceMock({
      send_message: {
        name: "send_message",
        description: "send",
        type: FunctionType.Action,
        requiredCapabilities: ["message.send"],
      },
    });

    const availability = buildToolSchemaForPrompt(
      pluginService as never,
      createToolCtx({
        core: {
          "message.send": { status: "available", source: "test" },
        },
        extended: {},
      }),
    );

    expect(availability).toContain("send_message (action)");
  });

  it("removes tools when capabilities are unavailable and strategy is remove", () => {
    const pluginService = createPluginServiceMock({
      ban: {
        name: "ban",
        type: FunctionType.Action,
        requiredCapabilities: ["member.moderate"],
        onCapabilityMissing: "remove",
      },
    });

    const availability = buildToolSchemaForPrompt(
      pluginService as never,
      createToolCtx({
        core: {},
        extended: {
          "member.moderate": { status: "unavailable", reason: "bot-not-admin" },
        },
      }),
    );

    expect(availability).not.toContain("ban (action)");
  });

  it("adds unavailable hint when strategy is hint", () => {
    const pluginService = createPluginServiceMock({
      reaction_create: {
        name: "reaction_create",
        type: FunctionType.Action,
        requiredCapabilities: ["social.reaction"],
        onCapabilityMissing: "hint",
      },
    });

    const availability = buildToolSchemaForPrompt(
      pluginService as never,
      createToolCtx({
        core: {},
        extended: {
          "social.reaction": { status: "unavailable", reason: "group-only" },
        },
      }),
    );

    expect(availability).toContain(
      "reaction_create: [unavailable — capabilities missing: social.reaction]",
    );
  });

  it("fails closed for unknown capability keys and logs warning via PluginService logger", () => {
    const pluginService = createPluginServiceHarnessWithUnknownLogger();

    const decision = pluginService.getRoundAvailability(createToolCtx({ core: {}, extended: {} }));

    expect(decision.visible.map((entry) => entry.function.name)).not.toContain("typo_tool");
    expect(decision.unavailable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "typo_tool",
          reason: "capability-missing",
          detail: "capabilities missing: typo.key",
        }),
      ]),
    );
    expect(pluginService.logger.warn).toHaveBeenCalledWith(
      '[capability-gate] Unknown capability key "typo.key" required by tool "typo_tool"',
    );
  });

  it("requires all capabilities for multi-capability tools", () => {
    const pluginService = createPluginServiceMock({
      dual_tool: {
        name: "dual_tool",
        type: FunctionType.Tool,
        requiredCapabilities: ["message.send", "member.moderate"],
      },
    });

    const availability = buildToolSchemaForPrompt(
      pluginService as never,
      createToolCtx({
        core: {
          "message.send": { status: "available" },
        },
        extended: {
          "member.moderate": { status: "unavailable", reason: "missing" },
        },
      }),
    );

    expect(availability).not.toContain("dual_tool (tool)");
  });

  it("keeps backward compatibility for tools without required capabilities", () => {
    const pluginService = createPluginServiceMock({
      legacy_tool: {
        name: "legacy_tool",
        type: FunctionType.Tool,
      },
    });

    const availability = buildToolSchemaForPrompt(
      pluginService as never,
      createToolCtx({ core: {}, extended: {} }),
    );

    expect(availability).toContain("legacy_tool (tool)");
  });

  it("defines CapabilityUnavailableError in plugin service", () => {
    expect(pluginServiceSource).toContain("class CapabilityUnavailableError extends Error");
    expect(pluginServiceSource).toContain('this.name = "CapabilityUnavailableError"');
    expect(pluginServiceSource).toContain("requiredCapabilities");
  });

  it("checks requiredCapabilities in invoke before handler", () => {
    expect(pluginServiceSource).toContain(
      "if (fn.requiredCapabilities?.length && context?.capabilities)",
    );
    expect(pluginServiceSource).toContain("new CapabilityUnavailableError");
    expect(pluginServiceSource).toContain("return Failed(error.message)");
  });

  it("wires platform capability resolvers in loop", () => {
    expect(loopSource).toContain("getCapabilityResolvers(percept.platform)");
    expect(loopSource).toContain("resolvers,");
  });

  it("unlocks hidden tools additively only when allowedTools requests them", () => {
    const pluginService = createPluginServiceWithHidden(
      {
        public_tool: {
          name: "public_tool",
          type: FunctionType.Tool,
        },
      },
      {
        search: {
          name: "search",
          type: FunctionType.Tool,
          hidden: true,
        },
      },
    );

    const baseAvailability = buildToolSchemaForPrompt(
      pluginService as never,
      createToolCtx({ core: {}, extended: {} }),
    );
    expect(baseAvailability).toContain("public_tool (tool)");
    expect(baseAvailability).not.toContain("search (tool)");

    const allowedAvailability = buildToolSchemaForPromptWithAllowed(
      pluginService as never,
      createToolCtx({ core: {}, extended: {} }),
      ["search"],
    );
    expect(allowedAvailability).toContain("search (tool)");
    expect(pluginService.getRoundAvailability).toHaveBeenCalledWith(expect.anything(), ["search"]);
  });

  it("keeps capability gating on allowed hidden tools with onCapabilityMissing hint", () => {
    const pluginService = createPluginServiceWithHidden(
      {
        public_tool: {
          name: "public_tool",
          type: FunctionType.Tool,
        },
      },
      {
        search: {
          name: "search",
          type: FunctionType.Tool,
          hidden: true,
          requiredCapabilities: ["message.read_history"],
          onCapabilityMissing: "hint",
        },
      },
    );

    const availability = buildToolSchemaForPromptWithAllowed(
      pluginService as never,
      createToolCtx({ core: {}, extended: {} }),
      ["search"],
    );

    expect(availability).toContain(
      "search: [unavailable — capabilities missing: message.read_history]",
    );
    expect(availability).not.toContain("search (tool)");
  });
});
