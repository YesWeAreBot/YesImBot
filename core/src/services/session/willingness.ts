import type { Context } from "koishi";

import { callLLMJudge, type JudgeResult } from "./llm-judge";
import type { WillingnessResult } from "./types/index";

export interface WillingnessJudgeParams {
  isDirect: boolean;
  atSelf: boolean;
  isReplyToBot: boolean;
  content: string;
  selfId: string;
  senderId: string;
  judgeEnabled?: boolean;
  judgeModel?: string;
  judgeTimeoutMs?: number;
}

export interface RuntimeWillingnessHeuristicParams {
  isDirect: boolean;
  atSelf: boolean;
  isReplyToBot: boolean;
  selfId: string;
  senderId: string;
}

export function evaluateRuntimeWillingnessHeuristic(
  params: RuntimeWillingnessHeuristicParams,
): WillingnessResult | null {
  if (params.senderId === params.selfId) {
    return { shouldRespond: false, reason: "self_message" };
  }

  if (params.isDirect) {
    return { shouldRespond: true, reason: "direct_message" };
  }

  if (params.atSelf) {
    return { shouldRespond: true, reason: "at_self" };
  }

  if (params.isReplyToBot && !params.atSelf) {
    return { shouldRespond: false, reason: "reply_without_at" };
  }

  return null;
}

function readJudgeEnabled(ctx: Context): boolean {
  const unknownConfig = (ctx as unknown as { config?: Record<string, unknown> }).config;
  return unknownConfig?.judgeEnabled === true;
}

export interface WillingnessJudge {
  judge(params: WillingnessJudgeParams): Promise<WillingnessResult>;
}

interface DefaultWillingnessJudgeOptions {
  ctx: Context;
  llmJudge?: (params: {
    content: string;
    judgeModel?: string;
    timeoutMs?: number;
  }) => Promise<JudgeResult | null>;
}

export class DefaultWillingnessJudge implements WillingnessJudge {
  private readonly ctx: Context;
  private readonly llmJudge: NonNullable<DefaultWillingnessJudgeOptions["llmJudge"]>;

  constructor(options: DefaultWillingnessJudgeOptions) {
    this.ctx = options.ctx;
    this.llmJudge =
      options.llmJudge ??
      ((params) =>
        callLLMJudge(this.ctx, {
          content: params.content,
          judgeModel: params.judgeModel,
          timeoutMs: params.timeoutMs,
        }));
  }

  async judge(params: WillingnessJudgeParams): Promise<WillingnessResult> {
    const judgeEnabled = params.judgeEnabled ?? readJudgeEnabled(this.ctx);
    if (!judgeEnabled) {
      return { shouldRespond: false, reason: "no_trigger" };
    }

    const judge = await this.llmJudge({
      content: params.content,
      judgeModel: params.judgeModel,
      timeoutMs: params.judgeTimeoutMs,
    });
    if (judge?.decision) {
      return { shouldRespond: true, reason: "llm_judge" };
    }

    return { shouldRespond: false, reason: "no_trigger" };
  }
}

export function createDefaultWillingnessJudge(ctx: Context): WillingnessJudge {
  return new DefaultWillingnessJudge({ ctx });
}

export async function judgeWillingness(
  ctx: Context,
  params: WillingnessJudgeParams,
): Promise<WillingnessResult> {
  const heuristic = evaluateRuntimeWillingnessHeuristic(params);
  if (heuristic) {
    return heuristic;
  }

  const judge = createDefaultWillingnessJudge(ctx);
  return judge.judge(params);
}
