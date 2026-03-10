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

import { ThinkActLoop } from "../src/services/agent/loop";
import { AgentCore } from "../src/services/agent/service";
import {
  bindCommittedRoundContext,
  buildCapabilitiesFromRuntime,
  commitRoundContext,
  createRoundContext,
} from "../src/services/runtime/adapters";
import type { Percept } from "../src/services/runtime/contracts";

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
    const promptRenderSpy = vi.fn().mockResolvedValue([
      { name: "soul", content: "soul" },
      { name: "instructions", content: "instructions" },
      { name: "extra", content: "extra" },
    ]);

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
        render: promptRenderSpy,
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
          promptInjections: [],
          toolFilter: undefined,
          styleOverride: undefined,
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
          timeline: [],
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
    };
    (ctx as unknown as Record<string, unknown>)["yesimbot.hook"] = hookService;

    const loop = new ThinkActLoop(ctx, {
      model: "openai:gpt",
      fallbackChain: [],
      maxRounds: 1,
    });

    await loop.run(percept as never, toolCtx as never);

    expect(promptRenderSpy).toHaveBeenCalledWith(
      "system",
      expect.objectContaining({
        percept,
        roundContext: expect.any(Object),
        scenario: expect.any(Object),
      }),
    );

    const passedScope = promptRenderSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(passedScope.roundContext).toBeTruthy();
    expect((passedScope.roundContext as Record<string, unknown>).snapshot).toBeTruthy();
    expect(passedScope.scenario).toEqual(
      expect.objectContaining({
        derived: expect.objectContaining({ attention: { level: "high" } }),
      }),
    );

    expect(toolCtxCapture.length).toBeGreaterThan(0);
    const capturedCtx = toolCtxCapture[0] as Record<string, unknown>;
    expect(capturedCtx.roundContext).toBeTruthy();
    expect(capturedCtx.scenario).toBeTruthy();
  });
});
