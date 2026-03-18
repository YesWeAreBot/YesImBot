import { describe, expect, it, vi } from "vitest";

import type { Percept } from "../src/runtime/contracts";
import { ThinkActLoop } from "../src/services/agent/loop";
import { AgentSessionStore } from "../src/services/skill/session-store";
import type { SkillDefinition } from "../src/services/skill/types";

function createPercept(): Percept {
  return {
    id: "wake-1",
    traceId: "trace-1",
    type: "mention",
    platform: "discord",
    channelId: "c1",
    timestamp: new Date("2026-03-14T00:00:00Z"),
    metadata: { messageId: "m1", senderId: "u1" },
  };
}

function createSkillDefinition(name: string): SkillDefinition {
  return {
    name,
    description: `${name} description`,
    guidance: `guidance for ${name}`,
    allowedTools: ["search"],
    source: "plugin",
    rootDir: `/skills/${name}`,
  };
}

describe("agent loop skill loading", () => {
  it("main loop runs without mandatory TraitAnalyzer stage", async () => {
    const traitAnalyze = vi.fn();
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
      "yesimbot.plugin": {
        getTools: vi.fn(() => []),
        getDefinition: vi.fn(),
        invoke: vi.fn(),
      },
      "yesimbot.prompt": {
        emitPromptBlocks: vi.fn().mockResolvedValue({
          sections: [],
          stableBlock: "",
          dynamicBlock: "",
          stableSignature: "sig",
        }),
        registerFragmentSource: vi.fn(() => () => undefined),
        inject: vi.fn(() => () => undefined),
      },
      "yesimbot.model": {
        getProvider: vi.fn(() => ({ providerType: "openai" })),
        call: vi.fn().mockResolvedValue({ text: JSON.stringify({ actions: [] }), usage: {} }),
      },
      "yesimbot.trait": undefined,
      "yesimbot.skill": {
        get: vi.fn(),
        resolve: vi.fn().mockReturnValue({
          activeSkills: [],
          promptFragments: [],
          styleFragment: null,
          toolFilter: { include: [], exclude: [] },
        }),
      },
      "yesimbot.arousal": undefined,
    } as unknown as ConstructorParameters<typeof ThinkActLoop>[0];

    const loop = new ThinkActLoop(ctx, { model: "openai:gpt", fallbackChain: [], maxRounds: 1 });
    await expect(
      loop.run(createPercept(), {
        platform: "discord",
        channelId: "c1",
        session: { isDirect: false, quote: undefined },
        bot: { selfId: "bot-1", user: { name: "Athena" } },
      } as never),
    ).resolves.toEqual({ totalTokens: 0, totalToolCalls: 0 });
    expect(traitAnalyze).not.toHaveBeenCalled();
  });

  it("main loop projects session-loaded skills into committed round skill state", async () => {
    const skill = createSkillDefinition("test-skill");
    const executeAgentEnd = vi.fn();
    const sessionStore = new AgentSessionStore({
      logger: vi.fn(() => ({ info: vi.fn() })),
    } as never);
    sessionStore.loadSkill("discord", "c1", skill);
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
      "yesimbot.plugin": { getTools: vi.fn(() => []), getDefinition: vi.fn(), invoke: vi.fn() },
      "yesimbot.prompt": {
        emitPromptBlocks: vi.fn().mockResolvedValue({
          sections: [],
          stableBlock: "",
          dynamicBlock: "",
          stableSignature: "sig",
        }),
        registerFragmentSource: vi.fn(() => () => undefined),
        inject: vi.fn(() => () => undefined),
      },
      "yesimbot.model": {
        getProvider: vi.fn(() => ({ providerType: "openai" })),
        call: vi.fn().mockResolvedValue({ text: JSON.stringify({ actions: [] }), usage: {} }),
      },
      "yesimbot.trait": { analyze: vi.fn().mockResolvedValue([]) },
      "yesimbot.skill": {
        all: vi.fn(() => [skill]),
        get: vi.fn((name: string) => (name === "test-skill" ? skill : undefined)),
      },
      "yesimbot.hook": {
        executeAgentStart: vi.fn(async (params: Record<string, unknown>) => ({
          skipped: false,
          params,
        })),
        executeAgentEnd,
      },
      "yesimbot.session": sessionStore,
      "yesimbot.arousal": undefined,
    } as unknown as ConstructorParameters<typeof ThinkActLoop>[0];

    const loop = new ThinkActLoop(ctx, { model: "openai:gpt", fallbackChain: [], maxRounds: 1 });
    await loop.run(createPercept(), { platform: "discord", channelId: "c1" } as never);

    const endParams = executeAgentEnd.mock.calls[0]?.[0] as {
      roundContext?: { skillState?: { active?: string[] } };
    };
    expect(endParams.roundContext?.skillState?.active).toContain("test-skill");
  });

  it("registers loop skill catalog and tool fragment sources", async () => {
    const skill = createSkillDefinition("fragment-skill");
    const registerFragmentSource = vi.fn(() => () => undefined);
    const sessionStore = new AgentSessionStore({
      logger: vi.fn(() => ({ info: vi.fn() })),
    } as never);
    sessionStore.loadSkill("discord", "c1", skill);
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
      "yesimbot.plugin": { getTools: vi.fn(() => []), getDefinition: vi.fn(), invoke: vi.fn() },
      "yesimbot.prompt": {
        emitPromptBlocks: vi.fn().mockResolvedValue({
          sections: [],
          stableBlock: "",
          dynamicBlock: "",
          stableSignature: "sig",
        }),
        registerFragmentSource,
        inject: vi.fn(() => () => undefined),
      },
      "yesimbot.model": {
        getProvider: vi.fn(() => ({ providerType: "openai" })),
        call: vi.fn().mockResolvedValue({ text: JSON.stringify({ actions: [] }), usage: {} }),
      },
      "yesimbot.trait": { analyze: vi.fn().mockResolvedValue([]) },
      "yesimbot.skill": {
        all: vi.fn(() => [skill]),
        get: vi.fn((name: string) => (name === "fragment-skill" ? skill : undefined)),
      },
      "yesimbot.hook": {
        executeAgentStart: vi.fn(async (params: Record<string, unknown>) => ({
          skipped: false,
          params,
        })),
        executeAgentEnd: vi.fn(),
      },
      "yesimbot.session": sessionStore,
      "yesimbot.arousal": undefined,
    } as unknown as ConstructorParameters<typeof ThinkActLoop>[0];

    const loop = new ThinkActLoop(ctx, { model: "openai:gpt", fallbackChain: [], maxRounds: 1 });
    await loop.run(createPercept(), { platform: "discord", channelId: "c1" } as never);

    expect(
      registerFragmentSource.mock.calls.some((call) =>
        String((call as unknown[])[0]).startsWith("__loop_skill_catalog_"),
      ),
    ).toBe(true);
    expect(
      registerFragmentSource.mock.calls.some((call) =>
        String((call as unknown[])[0]).startsWith("__loop_tool_fragments_"),
      ),
    ).toBe(true);
  });
});
