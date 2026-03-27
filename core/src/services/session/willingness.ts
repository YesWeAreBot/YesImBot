import type { Context } from "koishi";

import { callLLMJudge } from "./llm-judge";
import type { WillingnessResult } from "./types";

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

function readJudgeEnabled(ctx: Context): boolean {
  const unknownConfig = (ctx as unknown as { config?: Record<string, unknown> }).config;
  return unknownConfig?.judgeEnabled === true;
}

export async function judgeWillingness(
  ctx: Context,
  params: WillingnessJudgeParams,
): Promise<WillingnessResult> {
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

  const judgeEnabled = params.judgeEnabled ?? readJudgeEnabled(ctx);
  if (!judgeEnabled) {
    return { shouldRespond: false, reason: "no_trigger" };
  }

  const judge = await callLLMJudge(ctx, {
    content: params.content,
    judgeModel: params.judgeModel,
    timeoutMs: params.judgeTimeoutMs,
  });
  if (judge?.decision) {
    return { shouldRespond: true, reason: "llm_judge" };
  }

  return { shouldRespond: false, reason: "no_trigger" };
}
