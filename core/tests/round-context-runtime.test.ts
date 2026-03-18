import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
  function createSchemaChain() {
    const chain: Record<string, unknown> = {};
    const handler: ProxyHandler<Record<string, unknown>> = {
      get: (_target, prop) => {
        if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag) return undefined;
        return (..._args: unknown[]) => new Proxy(chain, handler);
      },
    };
    return new Proxy(chain, handler);
  }

  const schemaMock = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "intersect" || prop === "object" || prop === "array") {
          return (..._args: unknown[]) => createSchemaChain();
        }
        if (prop === "number" || prop === "string" || prop === "boolean") {
          return () => createSchemaChain();
        }
        if (prop === "dynamic") {
          return () => createSchemaChain();
        }
        return (..._args: unknown[]) => createSchemaChain();
      },
    },
  );

  class Service {
    ctx: Record<string, unknown>;
    config: unknown;
    logger: Record<string, unknown>;

    constructor(ctx: Record<string, unknown>, _name: string, _immediate?: boolean) {
      this.ctx = ctx;
      this.config = {};
      this.logger = (ctx.logger as (name: string) => Record<string, unknown>)("mock");
    }
  }

  return {
    Schema: schemaMock,
    Context: class {},
    Service,
    Random: { id: () => "mock-rand" },
    h: Object.assign(
      (type: string, attrs?: Record<string, unknown>, children?: unknown[]) => ({
        type,
        attrs,
        children: children ?? [],
      }),
      {
        parse: (content: string) => [content],
      },
    ),
    sleep: vi.fn(async () => undefined),
  };
});

import {
  bindCommittedRoundContext,
  buildCapabilitiesFromRuntime,
  commitRoundContext,
  createRoundContext,
} from "../src/runtime/adapters";
import { DEFAULT_SCENARIO_TIMELINE_SEMANTICS, type Percept } from "../src/runtime/contracts";
import { ThinkActLoop } from "../src/services/agent/loop";
import { AgentCore } from "../src/services/agent/service";

function createScenarioTimeline() {
  return {
    turns: [],
    activeSegment: { mode: "after-latest-summary" as const },
    markedEvents: [],
    heartbeatEvents: [],
    semantics: DEFAULT_SCENARIO_TIMELINE_SEMANTICS,
  };
}

describe("round context runtime", () => {
  it("AgentCore builds Percept without copying message content or sender name", () => {
    const ctx = {
      logger: vi.fn(() => ({
        level: 2,
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      })),
      command: vi.fn(() => ({})),
    } as unknown as never;

    const agent = new AgentCore(ctx, {});
    const built = (
      agent as unknown as {
        buildPercept: (
          event: unknown,
          traceId?: string,
        ) => { percept: { metadata?: Record<string, unknown> } };
      }
    ).buildPercept(
      {
        platform: "discord",
        channelId: "c1",
        timestamp: new Date("2026-03-10T00:00:00Z"),
        triggerType: "mention",
        payload: {
          messageId: "m1",
          content: "hello",
          senderId: "u1",
          senderName: "alice",
        },
        runtime: {
          session: {
            bot: { selfId: "bot-1", user: { name: "Athena" } },
          },
        },
      },
      "trace-1",
    );

    expect(built.percept.metadata).toBeTruthy();
    const metadata = built.percept.metadata as Record<string, unknown>;
    expect(metadata.content).toBeUndefined();
    expect(metadata.senderName).toBeUndefined();
  });

  it("ThinkActLoop passes roundContext and scenario into prompt scope", async () => {
    const emitPromptBlocksSpy = vi.fn().mockResolvedValue({
      sections: [
        { name: "identity", content: "<identity>identity</identity>", cacheable: true },
        { name: "policy", content: "<policy>policy</policy>", cacheable: true },
        { name: "situation", content: "<situation>situation</situation>", cacheable: false },
      ],
      stableBlock: "<identity>identity</identity>\n\n<policy>policy</policy>",
      dynamicBlock: "<situation>situation</situation>",
      stableSignature: "stable-signature",
    });

    const toolCtxCapture: unknown[] = [];
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
        getTools: vi.fn((toolCtx: unknown) => {
          toolCtxCapture.push(toolCtx);
          return [];
        }),
        getDefinition: vi.fn(),
        invoke: vi.fn(),
      },
      "yesimbot.prompt": {
        render: vi.fn(),
        emitPromptBlocks: emitPromptBlocksSpy,
        registerFragmentSource: vi.fn(() => () => undefined),
        inject: vi.fn(() => () => undefined),
      },
      "yesimbot.model": {
        getProvider: vi.fn(() => ({ providerType: "openai" })),
        call: vi.fn().mockResolvedValue({ text: JSON.stringify({ actions: [] }), usage: {} }),
      },
      "yesimbot.trait": {
        analyze: vi.fn().mockResolvedValue([]),
      },
      "yesimbot.skill": {
        resolve: vi.fn().mockReturnValue({
          activeSkills: [],
          promptFragments: [],
          toolFilter: { include: [], exclude: [] },
          styleFragment: null,
        }),
      },
      "yesimbot.arousal": undefined,
    } as unknown as ConstructorParameters<typeof ThinkActLoop>[0];

    const percept: Percept = {
      id: "wake-1",
      traceId: "trace-1",
      type: "mention",
      platform: "discord",
      channelId: "c1",
      timestamp: new Date("2026-03-10T00:00:00Z"),
      metadata: { messageId: "m1", senderId: "u1" },
    };

    const roundContext = createRoundContext({
      percept,
      scenario: {
        raw: {
          self: { id: "bot", name: "Athena" },
          environment: {
            type: "group",
            id: "c1",
            name: "General",
            platform: "discord",
            channelId: "c1",
          },
          entities: [],
          timeline: createScenarioTimeline(),
          scenarioTimeline: createScenarioTimeline(),
          stimulusSource: { type: "message", messageId: "m1", senderId: "u1" },
        },
        derived: {
          focus: {},
          participants: [],
          attention: {},
          recentMetrics: {},
        },
      },
      capabilities: buildCapabilitiesFromRuntime({
        session: { isDirect: false, quote: undefined },
        bot: { selfId: "bot-1" },
      }),
    });

    const toolCtx = bindCommittedRoundContext(
      {
        platform: "discord",
        channelId: "c1",
        session: { isDirect: false, quote: undefined },
        bot: { selfId: "bot-1", user: { name: "Athena" } },
        view: {
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
        },
        traits: [],
        skills: [],
      },
      roundContext,
    );

    const hookService = {
      executeBefore: vi.fn().mockResolvedValue({
        skipped: false,
        params: {
          view: toolCtx.view,
          traits: toolCtx.traits,
          skills: toolCtx.skills,
          percept,
          scenario: commitRoundContext(roundContext, {
            scenario: {
              ...roundContext.scenario,
              derived: {
                ...roundContext.scenario.derived,
                attention: { level: "high" },
              },
            },
          }).snapshot.scenario,
        },
      }),
      executeAfter: vi.fn().mockResolvedValue(undefined),
    };
    (ctx as unknown as Record<string, unknown>)["yesimbot.hook"] = hookService;

    const loop = new ThinkActLoop(ctx, {
      model: "openai:gpt",
      fallbackChain: [],
      maxRounds: 1,
    });

    await loop.run(percept as never, toolCtx as never);

    expect(emitPromptBlocksSpy).toHaveBeenCalledWith(
      "system",
      expect.objectContaining({
        percept,
        roundContext: expect.any(Object),
        scenario: expect.any(Object),
      }),
      expect.objectContaining({
        providerType: "openai",
      }),
    );

    const passedScope = emitPromptBlocksSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(passedScope.roundContext).toBeTruthy();
    expect((passedScope.roundContext as Record<string, unknown>).snapshot).toBeTruthy();
    expect(passedScope.scenario).toEqual(
      expect.objectContaining({
        derived: expect.objectContaining({ attention: { level: "high" } }),
      }),
    );

    expect(ctx["yesimbot.prompt"].registerFragmentSource).toHaveBeenCalledWith(
      expect.stringContaining("__loop_tool_fragments_"),
      expect.any(Function),
    );
  });

  it("completes baseline runtime fields before agent-start hook mutation", async () => {
    const capturedStartParams: Array<Record<string, unknown>> = [];
    const skillResolve = vi
      .fn()
      .mockReturnValueOnce({
        activeSkills: [{ name: "resolve-once" }],
        promptFragments: [],
        toolFilter: { include: [], exclude: [] },
        styleFragment: null,
      })
      .mockReturnValueOnce({
        activeSkills: [{ name: "resolve-twice" }],
        promptFragments: [],
        toolFilter: { include: [], exclude: [] },
        styleFragment: null,
      });
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
        render: vi.fn(),
        emitPromptBlocks: vi.fn().mockResolvedValue({
          sections: [
            { name: "identity", content: "<identity>identity</identity>", cacheable: true },
            { name: "policy", content: "<policy>policy</policy>", cacheable: true },
            { name: "situation", content: "<situation>situation</situation>", cacheable: false },
          ],
          stableBlock: "<identity>identity</identity>\n\n<policy>policy</policy>",
          dynamicBlock: "<situation>situation</situation>",
          stableSignature: "stable-signature",
        }),
        registerFragmentSource: vi.fn(() => () => undefined),
        inject: vi.fn(() => () => undefined),
      },
      "yesimbot.model": {
        getProvider: vi.fn(() => ({ providerType: "openai" })),
        call: vi.fn().mockResolvedValue({ text: JSON.stringify({ actions: [] }), usage: {} }),
      },
      "yesimbot.trait": {
        analyze: vi.fn().mockResolvedValue([{ dimension: "scene", value: "group" }]),
      },
      "yesimbot.skill": {
        resolve: skillResolve,
      },
      "yesimbot.hook": {
        executeAgentStart: vi.fn(async (params: unknown) => {
          capturedStartParams.push(params as Record<string, unknown>);
          return { skipped: false, params };
        }),
        executeAgentEnd: vi.fn(async () => undefined),
      },
      "yesimbot.arousal": undefined,
    } as unknown as ConstructorParameters<typeof ThinkActLoop>[0];

    const loop = new ThinkActLoop(ctx, {
      model: "openai:gpt",
      fallbackChain: [],
      maxRounds: 1,
    });

    const percept: Percept = {
      id: "wake-2",
      traceId: "trace-2",
      type: "mention",
      platform: "discord",
      channelId: "c1",
      timestamp: new Date("2026-03-10T00:00:00Z"),
      metadata: { messageId: "m2", senderId: "u2" },
    };

    await loop.run(percept, {
      platform: "discord",
      channelId: "c1",
      session: { isDirect: false, quote: undefined },
      bot: { selfId: "bot-1", user: { name: "Athena" } },
    } as never);

    expect(capturedStartParams.length).toBe(1);
    expect(capturedStartParams[0]).toEqual(
      expect.objectContaining({
        view: expect.any(Object),
        traits: expect.any(Array),
        skills: expect.any(Array),
        percept,
        roundContext: expect.any(Object),
        scenario: expect.any(Object),
        capabilities: expect.any(Object),
      }),
    );
    expect(skillResolve).not.toHaveBeenCalled();

    const beforeParams = capturedStartParams[0] as {
      skills?: Array<{ name: string }>;
      skillState?: { active?: string[] };
      roundContext?: { skillState?: { active?: string[] } };
    };
    expect(beforeParams.skills?.map((skill) => skill.name)).toEqual([]);
    expect(beforeParams.skillState).toMatchObject({ active: [] });
    expect(beforeParams.roundContext?.skillState).toMatchObject({ active: [] });
  });

  it("recalibrates legacy direct loop calls with inbound roundContext through round-entry baseline", async () => {
    const promptRenderSpy = vi.fn().mockResolvedValue([
      { name: "soul", content: "soul" },
      { name: "instructions", content: "instructions" },
      { name: "extra", content: "extra" },
    ]);

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
            id: "fresh-c1",
            name: "Fresh",
            platform: "discord",
            channelId: "fresh-c1",
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
        render: vi.fn(),
        emitPromptBlocks: vi
          .fn()
          .mockImplementation(async (_template: string, scope: Record<string, unknown>) => {
            promptRenderSpy("system", scope);
            return {
              sections: [
                { name: "identity", content: "<identity>identity</identity>", cacheable: true },
                { name: "policy", content: "<policy>policy</policy>", cacheable: true },
                {
                  name: "situation",
                  content: "<situation>situation</situation>",
                  cacheable: false,
                },
              ],
              stableBlock: "<identity>identity</identity>\n\n<policy>policy</policy>",
              dynamicBlock: "<situation>situation</situation>",
              stableSignature: "stable-signature",
            };
          }),
        registerFragmentSource: vi.fn(() => () => undefined),
        inject: vi.fn(() => () => undefined),
      },
      "yesimbot.model": {
        getProvider: vi.fn(() => ({ providerType: "openai" })),
        call: vi.fn().mockResolvedValue({ text: JSON.stringify({ actions: [] }), usage: {} }),
      },
      "yesimbot.trait": {
        analyze: vi.fn().mockResolvedValue([]),
      },
      "yesimbot.skill": {
        resolve: vi.fn().mockReturnValue({
          activeSkills: [],
          promptFragments: [],
          toolFilter: { include: [], exclude: [] },
          styleFragment: null,
        }),
      },
      "yesimbot.hook": undefined,
      "yesimbot.arousal": undefined,
    } as unknown as ConstructorParameters<typeof ThinkActLoop>[0];

    const percept: Percept = {
      id: "legacy-1",
      traceId: "trace-legacy-1",
      type: "mention",
      platform: "discord",
      channelId: "fresh-c1",
      timestamp: new Date("2026-03-10T00:00:00Z"),
      metadata: { messageId: "m-legacy", senderId: "u-legacy" },
    };

    const staleRoundContext = createRoundContext({
      percept,
      scenario: {
        raw: {
          self: { id: "bot", name: "Athena" },
          environment: {
            type: "group",
            id: "stale-c1",
            name: "Stale",
            platform: "discord",
            channelId: "stale-c1",
          },
          entities: [],
          timeline: createScenarioTimeline(),
          scenarioTimeline: createScenarioTimeline(),
          stimulusSource: { type: "message", messageId: "stale", senderId: "u0" },
        },
        derived: {
          focus: {},
          participants: [],
          attention: {},
          recentMetrics: {},
        },
      },
      capabilities: buildCapabilitiesFromRuntime({
        session: { isDirect: true, quote: undefined },
        bot: { selfId: "bot-1" },
      }),
      metadata: {
        channelKey: "discord:stale-c1",
        traceId: "trace-stale",
      },
      skillState: { active: [] },
    });

    const loop = new ThinkActLoop(ctx, {
      model: "openai:gpt",
      fallbackChain: [],
      maxRounds: 1,
    });

    await loop.run(percept, {
      platform: "discord",
      channelId: "fresh-c1",
      session: { isDirect: false, quote: undefined },
      bot: { selfId: "bot-1", user: { name: "Athena" } },
      roundContext: staleRoundContext,
    } as never);

    const passedScope = promptRenderSpy.mock.calls[0]?.[1] as {
      scenario?: { raw?: { environment?: { id?: string } } };
      roundContext?: {
        snapshot?: {
          metadata?: Record<string, unknown>;
        };
      };
    };

    expect(passedScope.scenario?.raw?.environment?.id).toBe("fresh-c1");
    expect(passedScope.roundContext?.snapshot?.metadata).toMatchObject({
      channelKey: "discord:fresh-c1",
      traceId: "trace-legacy-1",
    });
  });

  it("RoundContext skillState includes loadHistory field", () => {
    const now = Date.now();
    const roundContext = createRoundContext({
      percept: {
        id: "wake-load-history",
        traceId: "trace-load-history",
        type: "mention",
        platform: "discord",
        channelId: "c1",
        timestamp: new Date("2026-03-10T00:00:00Z"),
      },
      scenario: {
        raw: {
          self: { id: "bot", name: "Athena" },
          environment: {
            type: "group",
            id: "c1",
            name: "General",
            platform: "discord",
            channelId: "c1",
          },
          entities: [],
          timeline: createScenarioTimeline(),
          scenarioTimeline: createScenarioTimeline(),
          stimulusSource: { type: "message" },
        },
        derived: {
          focus: {},
          participants: [],
          attention: {},
          recentMetrics: {},
        },
      },
      capabilities: buildCapabilitiesFromRuntime({
        session: { isDirect: false, quote: undefined },
        bot: { selfId: "bot-1" },
      }),
      skillState: {
        active: ["foo"],
        loadHistory: [{ name: "foo", status: "loaded", timestamp: now }],
      },
    });

    expect(roundContext.skillState.loadHistory).toEqual([
      { name: "foo", status: "loaded", timestamp: now },
    ]);
  });

  it("RoundContext skillState includes persistentRoster field", () => {
    const roundContext = createRoundContext({
      percept: {
        id: "wake-persistent-roster",
        traceId: "trace-persistent-roster",
        type: "mention",
        platform: "discord",
        channelId: "c1",
        timestamp: new Date("2026-03-10T00:00:00Z"),
      },
      scenario: {
        raw: {
          self: { id: "bot", name: "Athena" },
          environment: {
            type: "group",
            id: "c1",
            name: "General",
            platform: "discord",
            channelId: "c1",
          },
          entities: [],
          timeline: createScenarioTimeline(),
          scenarioTimeline: createScenarioTimeline(),
          stimulusSource: { type: "message" },
        },
        derived: {
          focus: {},
          participants: [],
          attention: {},
          recentMetrics: {},
        },
      },
      capabilities: buildCapabilitiesFromRuntime({
        session: { isDirect: false, quote: undefined },
        bot: { selfId: "bot-1" },
      }),
      skillState: {
        active: ["foo"],
        persistentRoster: ["foo"],
      },
    });

    expect(roundContext.skillState.persistentRoster).toEqual(["foo"]);
  });

  it("runtime and hook contracts expose persisted skill state without hook-side skill loading", () => {
    const runtimeContracts = readFileSync(
      new URL("../src/runtime/contracts.ts", import.meta.url),
      "utf8",
    );
    const hookTypes = readFileSync(
      new URL("../src/services/hook/types.ts", import.meta.url),
      "utf8",
    );

    expect(runtimeContracts).toContain("loadHistory?: LoadAttempt[]");
    expect(runtimeContracts).toContain("persistentRoster?: string[]");
    expect(hookTypes).not.toContain("loadSkill(skillName: string)");
    expect(hookTypes).not.toContain("getLoadedSkills(): SkillDefinition[]");
  });
});
