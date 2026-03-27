import { describe, expect, it } from "vitest";

import {
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
  describe("rule-based judge", () => {
    it("triggers on direct message", () => {
      expect(judgeWillingness(makeParams({ isDirect: true }))).toEqual({
        shouldRespond: true,
        reason: "direct_message",
      });
    });

    it("triggers on at_self", () => {
      expect(judgeWillingness(makeParams({ atSelf: true }))).toEqual({
        shouldRespond: true,
        reason: "at_self",
      });
    });

    it("does not trigger on reply_without_at", () => {
      expect(judgeWillingness(makeParams({ isReplyToBot: true }))).toEqual({
        shouldRespond: false,
        reason: "reply_without_at",
      });
    });

    it("does not trigger on no_trigger", () => {
      expect(judgeWillingness(makeParams())).toEqual({
        shouldRespond: false,
        reason: "no_trigger",
      });
    });
  });

  describe("reason category", () => {
    it("returns reason string with every result", () => {
      const results = [
        judgeWillingness(makeParams({ isDirect: true })),
        judgeWillingness(makeParams({ atSelf: true })),
        judgeWillingness(makeParams({ isReplyToBot: true })),
      ];

      for (const result of results) {
        expect(typeof result.reason).toBe("string");
        expect(typeof result.shouldRespond).toBe("boolean");
      }
    });

    it("self_message reason for bot's own messages", () => {
      expect(judgeWillingness(makeParams({ senderId: "bot1", selfId: "bot1" }))).toEqual({
        shouldRespond: false,
        reason: "self_message",
      });
    });
  });
});
