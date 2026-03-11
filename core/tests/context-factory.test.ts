import type { Context } from "koishi";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { HookPhase, HookType } from "../src/services/hook/types";
import type { HorizonView } from "../src/services/horizon/types";
import type { ToolExecutionContext } from "../src/services/plugin/types";
import { createRoundContext } from "../src/services/runtime/adapters";
import {
  buildAgentContext,
  buildAgentRoundContext,
  buildHookContext,
  buildMinimalContext,
} from "../src/services/shared/context-factory";
import type { ActiveSkill, Percept, TraitSignal } from "../src/services/shared/types";

describe("context factory", () => {
  describe("buildMinimalContext", () => {
    it("returns platform and channelId only", () => {
      const ctx = buildMinimalContext({ platform: "onebot", channelId: "100" });
      expect(ctx).toEqual({ platform: "onebot", channelId: "100" });
      expect(Object.keys(ctx)).toEqual(["platform", "channelId"]);
    });

    it("includes session when provided", () => {
      const session = { platform: "onebot" } as ToolExecutionContext["session"];
      const ctx = buildMinimalContext({ platform: "onebot", channelId: "100", session });
      expect(ctx.session).toBe(session);
    });

    it("includes bot when provided", () => {
      const bot = { selfId: "bot-1" } as ToolExecutionContext["bot"];
      const ctx = buildMinimalContext({ platform: "onebot", channelId: "100", bot });
      expect(ctx.bot).toBe(bot);
    });

    it("does not include view/traits/skills/percept", () => {
      const ctx = buildMinimalContext({ platform: "onebot", channelId: "100" });
      expect(ctx.view).toBeUndefined();
      expect(ctx.traits).toBeUndefined();
      expect(ctx.skills).toBeUndefined();
      expect(ctx.percept).toBeUndefined();
    });
  });

  describe("buildAgentContext", () => {
    const traceId = "trace-123";
    const percept: Percept = {
      id: "p-1",
      traceId,
      type: "direct",
      platform: "onebot",
      channelId: "100",
      timestamp: new Date(),
    };
    const view: HorizonView = {
      self: { id: "bot", name: "YesImBot", role: "admin" },
      environment: {
        type: "guild",
        id: "100",
        name: "Test",
        platform: "onebot",
        channelId: "100",
      },
      entities: [],
      history: [],
    };
    const traits: TraitSignal[] = [{ dimension: "scene", value: "chat", confidence: 0.9 }];
    const skills: ActiveSkill[] = [{ name: "search", effects: ["web_access"] }];

    let logger: { warn: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      logger = { warn: vi.fn() };
    });

    const buildContext = (overrides: {
      buildView?: () => Promise<HorizonView>;
      analyze?: () => Promise<TraitSignal[]>;
      resolve?: () => { activeSkills: ActiveSkill[] };
    }) => {
      const ctx = {
        logger: () => logger,
        "yesimbot.horizon": {
          buildView: overrides.buildView ?? vi.fn().mockResolvedValue(view),
        },
        "yesimbot.trait": {
          analyze: overrides.analyze ?? vi.fn().mockResolvedValue(traits),
        },
        "yesimbot.skill": {
          resolve:
            overrides.resolve ??
            vi.fn().mockReturnValue({
              activeSkills: skills,
              promptInjections: [],
              toolFilter: undefined,
            }),
        },
      } as unknown as Context;

      return ctx;
    };

    it("returns complete context when services available", async () => {
      const ctx = buildContext({});
      const result = await buildAgentContext(ctx, {
        platform: "onebot",
        channelId: "100",
        percept,
      });

      expect(result.view).toEqual(view);
      expect(result.traits).toEqual(traits);
      expect(result.skills).toEqual(skills);
      expect(result.percept).toEqual(percept);
    });

    it("returns defaults and warns when view build fails", async () => {
      const ctx = buildContext({
        buildView: vi.fn().mockRejectedValue(new Error("boom")),
      });

      const result = await buildAgentContext(ctx, {
        platform: "onebot",
        channelId: "100",
        percept,
      });

      expect(result.view).toBeUndefined();
      expect(result.traits).toEqual([]);
      expect(result.skills).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(traceId));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("view"));
    });

    it("returns defaults and warns when trait analyze fails", async () => {
      const ctx = buildContext({
        analyze: vi.fn().mockRejectedValue(new Error("trait fail")),
      });

      const result = await buildAgentContext(ctx, {
        platform: "onebot",
        channelId: "100",
        percept,
      });

      expect(result.traits).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(traceId));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("traits"));
    });

    it("returns defaults and warns when skill resolve fails", async () => {
      const ctx = buildContext({
        resolve: vi.fn(() => {
          throw new Error("skill fail");
        }),
      });

      const result = await buildAgentContext(ctx, {
        platform: "onebot",
        channelId: "100",
        percept,
      });

      expect(result.skills).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(traceId));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("skills"));
    });
  });

  describe("buildHookContext", () => {
    it("wraps context with hookType and hookPhase", () => {
      const toolCtx = buildMinimalContext({ platform: "onebot", channelId: "100" });
      const hookCtx = buildHookContext(toolCtx, HookType.Tool, HookPhase.Before);
      expect(hookCtx.platform).toBe("onebot");
      expect(hookCtx.channelId).toBe("100");
      expect(hookCtx.hookType).toBe(HookType.Tool);
      expect(hookCtx.hookPhase).toBe(HookPhase.Before);
    });
  });

  describe("buildAgentRoundContext", () => {
    const percept: Percept = {
      id: "p-round-1",
      traceId: "trace-round-1",
      type: "mention",
      platform: "discord",
      channelId: "c1",
      timestamp: new Date("2026-03-11T00:00:00Z"),
      metadata: { messageId: "m1", senderId: "u1" },
    };

    const view: HorizonView = {
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
    };

    const buildServices = () => {
      const logger = { warn: vi.fn() };
      const horizon = {
        buildView: vi.fn().mockResolvedValue(view),
      };
      const trait = {
        analyze: vi.fn().mockResolvedValue([{ dimension: "scene", value: "chat", confidence: 1 }]),
      };
      const skill = {
        resolve: vi.fn().mockReturnValue({
          activeSkills: [{ name: "search", effects: ["web_access"] }],
          promptInjections: [],
          toolFilter: undefined,
        }),
      };

      const ctx = {
        logger: () => logger,
        "yesimbot.horizon": horizon,
        "yesimbot.trait": trait,
        "yesimbot.skill": skill,
      } as unknown as Context;

      return { ctx, horizon, trait, skill };
    };

    it("creates and binds a committed round baseline when no inbound roundContext exists", async () => {
      const { ctx } = buildServices();

      const result = await buildAgentRoundContext(ctx, {
        platform: "discord",
        channelId: "c1",
        percept,
        session: { isDirect: false, quote: undefined } as ToolExecutionContext["session"],
        bot: { selfId: "bot-1", user: { name: "Athena" } } as ToolExecutionContext["bot"],
      });

      expect(result.roundContext.snapshot.version).toBe(1);
      expect(result.toolCtx.roundContext).toBe(result.roundContext);
      expect(result.toolCtx.scenario).toBe(result.roundContext.snapshot.scenario);
      expect(result.toolCtx.capabilities).toBe(result.roundContext.snapshot.capabilities);
      expect(result.toolCtx.percept).toBe(percept);
    });

    it("calibrates and rebinds an inbound roundContext exactly once", async () => {
      const { ctx, horizon, trait, skill } = buildServices();
      const inboundRoundContext = createRoundContext({
        percept,
        scenario: {
          raw: {
            self: { id: "bot", name: "Athena" },
            environment: {
              type: "group",
              id: "legacy",
              name: "Legacy",
              platform: "discord",
              channelId: "c1",
            },
            entities: [],
            timeline: [],
            stimulusSource: { type: "message" },
          },
          derived: {
            focus: { source: "legacy" },
            participants: [],
            attention: {},
            recentMetrics: {},
          },
        },
        capabilities: {
          core: {
            sendMessage: { status: "unavailable", reason: "legacy" },
            readHistory: { status: "available" },
          },
          extended: {},
        },
        metadata: { channelKey: "legacy:c1", traceId: "legacy-trace" },
        skillState: { active: ["legacy-skill"] },
      });

      const result = await buildAgentRoundContext(ctx, {
        platform: "discord",
        channelId: "c1",
        percept,
        session: { isDirect: false, quote: undefined } as ToolExecutionContext["session"],
        bot: { selfId: "bot-1", user: { name: "Athena" } } as ToolExecutionContext["bot"],
        toolCtx: {
          platform: "discord",
          channelId: "c1",
          percept,
          view,
          traits: [{ dimension: "scene", value: "chat", confidence: 1 }],
          skills: [{ name: "search", effects: ["web_access"] }],
          roundContext: inboundRoundContext,
        },
      });

      expect(result.roundContext).not.toBe(inboundRoundContext);
      expect(result.roundContext.snapshot.version).toBe(inboundRoundContext.snapshot.version + 1);
      expect(result.toolCtx.roundContext).toBe(result.roundContext);
      expect(result.roundContext.metadata).toEqual({
        channelKey: "discord:c1",
        traceId: percept.traceId,
      });
      expect(horizon.buildView).not.toHaveBeenCalled();
      expect(trait.analyze).not.toHaveBeenCalled();
      expect(skill.resolve).not.toHaveBeenCalled();
    });

    it("preserves same-round identity while advancing the committed snapshot", async () => {
      const { ctx } = buildServices();
      const inboundRoundContext = createRoundContext({
        percept,
        scenario: {
          raw: {
            ...view,
            timeline: [],
            stimulusSource: { type: "message", messageId: "legacy-message" },
          },
          derived: {
            focus: {},
            participants: [],
            attention: {},
            recentMetrics: {},
          },
        },
        capabilities: {
          core: {
            sendMessage: { status: "available" },
            readHistory: { status: "available" },
          },
          extended: {},
        },
        metadata: { channelKey: "discord:c1", traceId: percept.traceId },
        skillState: { active: [] },
      });

      const result = await buildAgentRoundContext(ctx, {
        platform: "discord",
        channelId: "c1",
        percept,
        toolCtx: {
          platform: "discord",
          channelId: "c1",
          percept,
          view,
          traits: [],
          skills: [{ name: "search", effects: ["web_access"] }],
          roundContext: inboundRoundContext,
        },
      });

      expect(result.roundContext.percept).toBe(percept);
      expect(result.roundContext.snapshot.version).toBe(inboundRoundContext.snapshot.version + 1);
      expect(result.roundContext.skillState.active).toEqual(["search"]);
      expect(result.roundContext.metadata.traceId).toBe(percept.traceId);
    });
  });

  describe("ToolExecutionContext type safety", () => {
    it("does not accept arbitrary keys", () => {
      const ctx: ToolExecutionContext = {
        platform: "onebot",
        channelId: "100",
        // @ts-expect-error extra keys are not allowed
        extra: "nope",
      };
      expect(ctx.platform).toBe("onebot");
    });
  });
});
