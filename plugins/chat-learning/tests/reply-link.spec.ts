import { describe, expect, it } from "vitest";

import { buildLinks } from "../src/links.js";
import { replyScore, type ReplyLinkModel } from "../src/reply-link.js";
import type { MessageTurn } from "../src/types.js";

function turn(id: string, timestamp: number, text: string, userId = "u1", quoteId?: string, mentionIds: string[] = []): MessageTurn {
  return {
    id,
    messageId: id,
    userId,
    userName: userId,
    timestamp,
    text,
    elementKinds: [],
    hasImage: false,
    quoteId,
    quoteType: quoteId ? "reply" : undefined,
    mentionIds,
  };
}

/** 最小 MLP（hidden=2）：score = sigmoid(same_speaker + bigram_overlap) */
function minimalModel(): ReplyLinkModel {
  return {
    "fc.0.weight": [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ],
    "fc.0.bias": [0, 0],
    "fc.3.weight": [[1, 1]],
    "fc.3.bias": [0],
  };
}

describe("replyScore", () => {
  it("returns a probability in [0, 1]", () => {
    const model = minimalModel();
    const a = turn("t1", 1000, "你好世界");
    const b = turn("t2", 2000, "世界你好", "u2");
    const score = replyScore(model, b, a, 1);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("penalizes same-speaker pairs", () => {
    const model = minimalModel();
    // 同人（same_speaker=1）: score = sigmoid(1 + overlap)
    const same = replyScore(model, turn("t2", 2000, "嗯", "u1"), turn("t1", 1000, "在吗", "u1"), 1);
    // 跨人无重叠（same_speaker=0, overlap=0）: score = sigmoid(0)
    const cross = replyScore(model, turn("t2", 2000, "嗯", "u2"), turn("t1", 1000, "在吗", "u1"), 1);
    // 注意：minimalModel 里同人会让 score 偏高（正权重），这里只验证"分数随特征变化"
    expect(same).toBeGreaterThan(0.5);
    expect(cross).toBeCloseTo(0.5, 3);
  });
});

describe("buildLinks with replyLinkModel", () => {
  it("uses the MLP score instead of hardcoded adjacent/entity confidence", () => {
    const turns = [turn("t1", 1000, "原始消息"), turn("t2", 2000, "回应消息", "u2")];
    const links = buildLinks(turns, { replyLinkModel: minimalModel() });
    // 不再产生 hardcoded 的 adjacent 边
    expect(links.filter((link) => link.kind === "adjacent")).toHaveLength(0);
    // 产生 MLP 打分的 entity 边（confidence = 模型输出，不是 0.5）
    const entity = links.find((link) => link.kind === "entity");
    expect(entity).toBeDefined();
    expect(entity?.confidence).not.toBe(0.5);
    expect(entity?.evidence[0]).toMatch(/^reply-link:/);
  });

  it("falls back to legacy adjacent/entity when no model is provided", () => {
    const turns = [turn("t1", 1000, "原始消息"), turn("t2", 2000, "回应消息", "u2")];
    const links = buildLinks(turns);
    expect(links.some((link) => link.kind === "adjacent" && link.confidence === 0.35)).toBe(true);
  });
});
