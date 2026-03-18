import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildToolPromptFragments } from "../src/services/agent/tools";
import { FunctionType, type ToolExecutionContext } from "../src/services/plugin/types";

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
    getTools: vi.fn(() => entries),
    getDefinition: vi.fn((name: string) => definitions[name]),
  };
}

function buildToolSchemaForPrompt(pluginService: never, toolCtx: ToolExecutionContext): string {
  const fragments = buildToolPromptFragments(pluginService, toolCtx);
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

  it("fails closed for unknown capability keys and logs warning", () => {
    const pluginService = createPluginServiceMock({
      typo_tool: {
        name: "typo_tool",
        type: FunctionType.Tool,
        requiredCapabilities: ["typo.key"],
      },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const availability = buildToolSchemaForPrompt(
      pluginService as never,
      createToolCtx({ core: {}, extended: {} }),
    );

    expect(availability).not.toContain("typo_tool (tool)");
    expect(warnSpy).toHaveBeenCalledWith(
      '[capability-gate] Unknown capability key "typo.key" required by tool "typo_tool"',
    );
    warnSpy.mockRestore();
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
});
