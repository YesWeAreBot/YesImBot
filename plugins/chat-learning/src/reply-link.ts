import type { MessageTurn } from "./types.js";

/**
 * 回复边打分 MLP（4 维结构特征 → P(回复)）。
 *
 * 特征（与 export-reply-link.py 训练约定严格一致）：
 *   [same_speaker, bigram_overlap, log10(1+Δt秒), log10(1+位置距)]
 *
 * 数据依据（实验 65/66/67）：
 *   - @ 176×、跨人 1.48×、bigram 叠加跨人 1.91×、同人 0.27×、时间窗 0.94×（无用）
 *   - 回复距离用"消息数"（中位 7 条），不用"秒"（被群活跃度污染）
 *   - 该 MLP 群内 AUC 0.82、跨群 0.73，优于手调 entity/adjacent（lift 1.18–1.91）
 */

export interface ReplyLinkModel {
  readonly "fc.0.weight": readonly number[][];
  readonly "fc.0.bias": readonly number[];
  readonly "fc.3.weight": readonly number[][];
  readonly "fc.3.bias": readonly number[];
  readonly _meta?: { readonly dim: number; readonly hidden: number; readonly feat_names: readonly string[] };
}

export const REPLY_LINK_WINDOW = 10;
export const REPLY_LINK_THRESHOLD = 0.5;

export function parseReplyLinkModel(json: string): ReplyLinkModel {
  return JSON.parse(json) as ReplyLinkModel;
}

function cleanForBigram(text: string): string {
  return text
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/@[\w·\-]+/g, " ")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "");
}

function bigrams(text: string): Set<string> {
  const cleaned = cleanForBigram(text);
  const result = new Set<string>();
  for (let index = 0; index < cleaned.length - 1; index += 1) {
    result.add(cleaned.slice(index, index + 2));
  }
  return result;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function replyScore(model: ReplyLinkModel, turn: MessageTurn, previous: MessageTurn, positionDistance: number): number {
  const same = turn.userId === previous.userId ? 1 : 0;
  const overlap = jaccard(bigrams(turn.text), bigrams(previous.text));
  const timeGap = Math.log10(Math.max(1, Math.floor((turn.timestamp - previous.timestamp) / 1000)) + 1);
  const position = Math.log10(positionDistance + 1);
  const feats = [same, overlap, timeGap, position];
  const hidden = model["fc.0.bias"].length;
  const h = new Array<number>(hidden).fill(0);
  for (let i = 0; i < hidden; i += 1) {
    let sum = model["fc.0.bias"][i]!;
    for (let j = 0; j < 4; j += 1) sum += feats[j]! * model["fc.0.weight"][i]![j]!;
    h[i] = Math.max(0, sum);
  }
  let out = model["fc.3.bias"][0]!;
  for (let i = 0; i < hidden; i += 1) out += h[i]! * model["fc.3.weight"][0]![i]!;
  return 1 / (1 + Math.exp(-out));
}
