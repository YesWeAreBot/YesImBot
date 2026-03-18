import { describe, expect, it } from "vitest";

import { buildToolPromptFragments } from "../src/services/agent/tools";
import type { PluginService } from "../src/services/plugin/service";
import { FunctionType, type ToolExecutionContext } from "../src/services/plugin/types";

function createToolCtx(): ToolExecutionContext {
  return {
    platform: "test",
    channelId: "test-channel",
    capabilities: {
      core: {},
      extended: {},
    },
  };
}

describe("tool wording clarity (PROMPT-03)", () => {
  it("static protocol fragment uses 'tools' and 'actions' terminology without listing specific tools", () => {
    const mockPluginService = {
      getTools: () => [],
      getDefinition: () => undefined,
    } as unknown as PluginService;

    const fragments = buildToolPromptFragments(mockPluginService, createToolCtx());
    const protocolFragment = fragments.find((fragment) => fragment.id === "tooling.protocol");

    expect(protocolFragment).toBeDefined();
    expect(protocolFragment?.content.toLowerCase()).toContain("tool");
    expect(protocolFragment?.content.toLowerCase()).toContain("action");
    expect(protocolFragment?.content).not.toContain("send_message");
    expect(protocolFragment?.content).not.toContain("Available tools/actions this round");
  });

  it("dynamic availability fragment explicitly states 'this round' or 'current round'", () => {
    const mockPluginService = {
      getTools: () => [
        {
          function: { name: "send_message", description: "Send a message", parameters: {} },
          functionType: FunctionType.Action,
        },
      ],
      getDefinition: () => ({ type: FunctionType.Action }),
    } as unknown as PluginService;

    const fragments = buildToolPromptFragments(mockPluginService, createToolCtx());
    const availFragment = fragments.find((fragment) => fragment.id === "tooling.available");

    expect(availFragment).toBeDefined();
    expect(availFragment?.content.toLowerCase()).toMatch(/this round|current round/);
  });

  it("when no tools available, explicitly says so rather than omitting", () => {
    const mockPluginService = {
      getTools: () => [],
      getDefinition: () => undefined,
    } as unknown as PluginService;

    const fragments = buildToolPromptFragments(mockPluginService, createToolCtx());
    const availFragment = fragments.find((fragment) => fragment.id === "tooling.available");

    expect(availFragment).toBeDefined();
    expect(availFragment?.content.toLowerCase()).toContain("no tool");
  });
});
