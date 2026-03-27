import type { WillingnessResult } from "./types";

export interface WillingnessJudgeParams {
  isDirect: boolean;
  atSelf: boolean;
  isReplyToBot: boolean;
  content: string;
  selfId: string;
  senderId: string;
}

export function judgeWillingness(params: WillingnessJudgeParams): WillingnessResult {
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

  return { shouldRespond: false, reason: "no_trigger" };
}
