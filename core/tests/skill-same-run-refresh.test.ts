import { describe, expect, it, vi } from "vitest";

import type { Percept } from "../src/runtime/contracts";
import { ThinkActLoop } from "../src/services/agent/loop";
import { FunctionType } from "../src/services/plugin/types";
import { AgentSessionStore } from "../src/services/skill/session-store";
import type { SkillDefinition } from "../src/services/skill/types";

function createPercept(): Percept {
  return {
    id: "wake-same-run",
    traceId: "trace-same-run",
    type: "mention",
    platform: "discord",
    channelId: "c1",
    timestamp: new Date("2026-03-15T00:00:00Z"),
    metadata: { messageId: "m1", senderId: "u1" },
  };
}

describe("skill same-run refresh", () => {
  it("shows newly allowed tool in second model iteration of same run", async () => {
    const sessionStore = new AgentSessionStore({
      logger: vi.fn(() => ({ info: vi.fn() })),
    } as never);

    const searchSkill: SkillDefinition = {
      name: "search",
      description: "Enable hidden search lookup tool",
      guidance: "Use hidden search lookup for factual queries.",
      allowedTools: ["hidden_lookup"],
      source: "plugin",
      rootDir: "/skills/search",
    };

    const fragmentProviders = new Map<string, (scope: Record<string, unknown>) => unknown>();
    const roundToolAvailability: string[] = [];

    const pluginService = {
      getTools: vi.fn((_toolCtx: unknown, includeHidden?: boolean) => {
        const base = [
          {
            type: "function" as const,
            functionType: FunctionType.Tool,
            function: {
              name: "loadSkill",
              description: "Loads a skill",
              parameters: { type: "object", properties: {} },
            },
          },
        ];
        if (includeHidden) {
          return base.concat([
            {
              type: "function" as const,
              functionType: FunctionType.Tool,
              function: {
                name: "hidden_lookup",
                description: "Hidden lookup tool",
                parameters: { type: "object", properties: {} },
              },
            },
          ]);
        }
        return base;
      }),
      getDefinition: vi.fn((name: string) => ({
        name,
        description: name,
        type: FunctionType.Tool,
        parameters: {} as never,
        handler: vi.fn(),
      })),
      invoke: vi.fn(async (name: string, params: Record<string, unknown>) => {
        if (name === "loadSkill" && params.skillName === "search") {
          sessionStore.loadSkill("discord", "c1", searchSkill);
          return { success: true, status: "ok", content: "search loaded" };
        }
        return { success: true, status: "ok", content: "ok" };
      }),
    };

    const promptService = {
      registerFragmentSource: vi.fn(
        (name: string, provider: (scope: Record<string, unknown>) => unknown) => {
          fragmentProviders.set(name, provider);
          return () => fragmentProviders.delete(name);
        },
      ),
      emitPromptBlocks: vi.fn(async () => {
        const toolProvider = Array.from(fragmentProviders.entries()).find(([name]) =>
          name.startsWith("__loop_tool_fragments_"),
        )?.[1];
        const fragments = toolProvider
          ? ((await toolProvider({})) as Array<{ content?: string }>)
          : [];
        roundToolAvailability.push(fragments.map((f) => f.content ?? "").join("\n\n"));
        return {
          sections: [],
          stableBlock: "",
          dynamicBlock: "",
          stableSignature: "sig",
        };
      }),
    };

    const ctx = {
      baseDir: "/tmp",
      logger: vi.fn(() => ({
        level: 2,
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      })),
      "yesimbot.horizon": {
        buildView: vi.fn().mockResolvedValue({
          self: { id: "bot", name: "Athena" },
          environment: {
            type: "group",
            id: "c1",
            name: "General",
            platform: "discord",
            channelId: "c1",
          },
          entities: [],
          history: [],
        }),
        formatHorizonText: vi.fn().mockResolvedValue([]),
        events: {
          recordAgentResponse: vi.fn(),
          recordAgentAction: vi.fn(),
          recordMessage: vi.fn(),
          markAsActive: vi.fn(),
          archiveStale: vi.fn(),
        },
        compressor: undefined,
        config: { archiveThresholdMs: 86400000 },
      },
      "yesimbot.plugin": pluginService,
      "yesimbot.prompt": promptService,
      "yesimbot.model": {
        getProvider: vi.fn(() => ({ providerType: "openai" })),
        call: vi
          .fn()
          .mockResolvedValueOnce({
            text: JSON.stringify({
              actions: [{ name: "loadSkill", params: { skillName: "search" } }],
            }),
            usage: {},
          })
          .mockResolvedValueOnce({ text: JSON.stringify({ actions: [] }), usage: {} }),
      },
      "yesimbot.skill": {
        all: vi.fn(() => [searchSkill]),
        get: vi.fn((name: string) => (name === "search" ? searchSkill : undefined)),
      },
      "yesimbot.session": sessionStore,
      "yesimbot.arousal": undefined,
      "yesimbot.hook": undefined,
    } as unknown as ConstructorParameters<typeof ThinkActLoop>[0];

    const loop = new ThinkActLoop(ctx, { model: "openai:gpt", fallbackChain: [], maxRounds: 3 });
    await loop.run(createPercept(), { platform: "discord", channelId: "c1" } as never);

    expect(roundToolAvailability[0]).not.toContain("hidden_lookup");
    expect(roundToolAvailability[1]).toContain("hidden_lookup");
  });
});
