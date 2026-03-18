import { Context } from "koishi";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { HookService } from "../src/services/hook/service";
import { HookType, HookPhase } from "../src/services/hook/types";
import * as builtinPlugins from "../src/services/plugin/builtin";
import { CorePlugin } from "../src/services/plugin/builtin/core";
import { OnebotPlugin } from "../src/services/plugin/builtin/onebot";

describe("Hook Integration", () => {
  let ctx: Context;
  let hookService: HookService;

  beforeEach(() => {
    ctx = new Context();
    ctx.on = () => {};
    (ctx as unknown as { emit: (...args: unknown[]) => void }).emit = () => {};
    (ctx as unknown as { logger: (name: string) => Record<string, unknown> }).logger = () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      level: 2,
    });
    hookService = new HookService(ctx);
  });

  describe("executeBefore", () => {
    it("should return original params when no hooks registered", async () => {
      const params = { foo: "bar" };
      const result = await hookService.executeBefore(HookType.Tool, params, "trace-1");

      expect(result.params).toEqual(params);
      expect(result.skipped).toBe(false);
    });

    it("should modify params when hook returns modified result", async () => {
      const params = { value: 10 };

      hookService.register(ctx, {
        type: HookType.Tool,
        phase: HookPhase.Before,
        handler: async (ctx) => ({
          modified: true,
          params: { value: (ctx.params as { value: number }).value * 2 },
        }),
      });

      const result = await hookService.executeBefore(HookType.Tool, params, "trace-1");

      expect(result.params).toEqual({ value: 20 });
      expect(result.skipped).toBe(false);
    });

    it("should skip execution when hook returns skip result", async () => {
      const params = { value: 10 };

      hookService.register(ctx, {
        type: HookType.Tool,
        phase: HookPhase.Before,
        handler: async () => ({
          skip: true,
          result: { skipped: true },
        }),
      });

      const result = await hookService.executeBefore(HookType.Tool, params, "trace-1");

      expect(result.skipped).toBe(true);
      expect(result.result).toEqual({ skipped: true });
    });
  });

  describe("executeAfter", () => {
    it("should execute after hooks with result context", async () => {
      let capturedResult: unknown;

      hookService.register(ctx, {
        type: HookType.Tool,
        phase: HookPhase.After,
        handler: async (ctx) => {
          capturedResult = ctx.result;
        },
      });

      await hookService.executeAfter(
        HookType.Tool,
        { input: "test" },
        { output: "result" },
        "trace-1",
      );

      expect(capturedResult).toEqual({ output: "result" });
    });
  });

  describe("Tool hooks", () => {
    it("should intercept tool execution with before hook", async () => {
      const toolParams = { toolName: "search", query: "test" };

      hookService.register(ctx, {
        type: HookType.Tool,
        phase: HookPhase.Before,
        handler: async (ctx) => ({
          modified: true,
          params: { ...(ctx.params as typeof toolParams), query: "modified query" },
        }),
      });

      const result = await hookService.executeBefore(HookType.Tool, toolParams, "trace-1");

      expect(result.params).toEqual({ toolName: "search", query: "modified query" });
    });
  });

  describe("Agent hooks", () => {
    it("should intercept agent cycle with before hook", async () => {
      const agentParams = { view: {}, traits: [], skills: [] };

      hookService.register(ctx, {
        type: HookType.Agent,
        phase: HookPhase.Before,
        handler: async (ctx) => ({
          modified: true,
          params: { ...(ctx.params as typeof agentParams), injected: true },
        }),
      });

      const result = await hookService.executeBefore(HookType.Agent, agentParams, "trace-1");

      expect((result.params as typeof agentParams & { injected: boolean }).injected).toBe(true);
    });
  });

  describe("Plugin register path", () => {
    it("register path keeps production built-ins and skips hook-test fixture", () => {
      expect(builtinPlugins).toMatchObject({
        CorePlugin,
        OnebotPlugin,
      });
      expect(Object.keys(builtinPlugins).sort()).toEqual(["CorePlugin", "OnebotPlugin"]);
    });
  });
});
