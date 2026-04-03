import type { Context } from "koishi";
import { describe, expect, it, vi } from "vitest";

import * as llmJudge from "../../src/services/session/llm-judge";
import {
  DefaultWillingnessJudge,
  createDefaultWillingnessJudge,
  evaluateRuntimeWillingnessHeuristic,
  judgeWillingness,
  type WillingnessJudgeParams,
} from "../../src/services/session/willingness";

function makeParams(overrides: Partial<WillingnessJudgeParams> = {}): WillingnessJudgeParams {
  return {
    isDirect: false,
    atSelf: false,
    isReplyToBot: false,
    content: "hello",
    selfId: "bot1",
    senderId: "user1",
    ...overrides,
  };
}

describe("Willingness judge", () => {
  const ctx = {
    config: {
      judgeEnabled: false,
      model: "test:model",
    },
    "yesimbot.model": {
      resolve: vi.fn(),
    },
  } as unknown as Context;

  describe("rule-based judge", () => {
    it("exposes replaceable willingness judge abstraction", async () => {
      const judge = createDefaultWillingnessJudge(ctx);
      await expect(judge.judge(makeParams())).resolves.toEqual({
        shouldRespond: false,
        reason: "no_trigger",
      });
    });

    it("runtime heuristic resolves direct/at/reply/self boundaries", () => {
      expect(
        evaluateRuntimeWillingnessHeuristic(
          makeParams({ senderId: "bot1", selfId: "bot1", isDirect: true }),
        ),
      ).toEqual({
        shouldRespond: false,
        reason: "self_message",
      });
      expect(evaluateRuntimeWillingnessHeuristic(makeParams({ isDirect: true }))).toEqual({
        shouldRespond: true,
        reason: "direct_message",
      });
      expect(evaluateRuntimeWillingnessHeuristic(makeParams({ atSelf: true }))).toEqual({
        shouldRespond: true,
        reason: "at_self",
      });
      expect(evaluateRuntimeWillingnessHeuristic(makeParams({ isReplyToBot: true }))).toEqual({
        shouldRespond: false,
        reason: "reply_without_at",
      });
      expect(evaluateRuntimeWillingnessHeuristic(makeParams())).toBeNull();
    });

    it("triggers on direct message", async () => {
      const callSpy = vi.spyOn(llmJudge, "callLLMJudge");

      await expect(judgeWillingness(ctx, makeParams({ isDirect: true }))).resolves.toEqual({
        shouldRespond: true,
        reason: "direct_message",
      });

      expect(callSpy).not.toHaveBeenCalled();
      callSpy.mockRestore();
    });

    it("triggers on at_self", async () => {
      await expect(judgeWillingness(ctx, makeParams({ atSelf: true }))).resolves.toEqual({
        shouldRespond: true,
        reason: "at_self",
      });
    });

    it("does not trigger on reply_without_at", async () => {
      await expect(judgeWillingness(ctx, makeParams({ isReplyToBot: true }))).resolves.toEqual({
        shouldRespond: false,
        reason: "reply_without_at",
      });
    });

    it("does not trigger on no_trigger when judge disabled", async () => {
      await expect(judgeWillingness(ctx, makeParams())).resolves.toEqual({
        shouldRespond: false,
        reason: "no_trigger",
      });
    });

    it("triggers on gray-zone when judge returns decision=true", async () => {
      const callSpy = vi.spyOn(llmJudge, "callLLMJudge").mockResolvedValue({
        decision: true,
        confidence: 0.91,
      });

      await expect(
        judgeWillingness(ctx, makeParams({ judgeEnabled: true, content: "maybe reply" })),
      ).resolves.toEqual({
        shouldRespond: true,
        reason: "llm_judge",
      });

      expect(callSpy).toHaveBeenCalledTimes(1);
      callSpy.mockRestore();
    });

    it("fails closed when judge returns null", async () => {
      const callSpy = vi.spyOn(llmJudge, "callLLMJudge").mockResolvedValue(null);

      await expect(
        judgeWillingness(ctx, makeParams({ judgeEnabled: true, content: "gray-zone" })),
      ).resolves.toEqual({
        shouldRespond: false,
        reason: "no_trigger",
      });

      callSpy.mockRestore();
    });

    it("allows overriding llm judge implementation", async () => {
      const judge = new DefaultWillingnessJudge({
        ctx,
        llmJudge: vi.fn().mockResolvedValue({ decision: true }),
      });

      await expect(
        judge.judge(makeParams({ judgeEnabled: true, content: "gray-zone" })),
      ).resolves.toEqual({
        shouldRespond: true,
        reason: "llm_judge",
      });
    });

    it("deferred judge no longer handles runtime heuristic branches", async () => {
      const judge = new DefaultWillingnessJudge({ ctx });
      await expect(judge.judge(makeParams({ isDirect: true }))).resolves.toEqual({
        shouldRespond: false,
        reason: "no_trigger",
      });
    });
  });

  describe("reason category", () => {
    it("returns reason string with every result", async () => {
      const results = await Promise.all([
        judgeWillingness(ctx, makeParams({ isDirect: true })),
        judgeWillingness(ctx, makeParams({ atSelf: true })),
        judgeWillingness(ctx, makeParams({ isReplyToBot: true })),
      ]);

      for (const result of results) {
        expect(typeof result.reason).toBe("string");
        expect(typeof result.shouldRespond).toBe("boolean");
      }
    });

    it("self_message reason for bot's own messages", async () => {
      await expect(
        judgeWillingness(ctx, makeParams({ senderId: "bot1", selfId: "bot1" })),
      ).resolves.toEqual({
        shouldRespond: false,
        reason: "self_message",
      });
    });
  });
});
