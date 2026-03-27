import type { WillingnessResult } from "./types";

export interface WillingnessJudgeParams {
  isDirect: boolean;
  atSelf: boolean;
  isReplyToBot: boolean;
  content: string;
  triggerKeywords: string[];
  selfId: string;
  senderId: string;
}

export function judgeWillingness(params: WillingnessJudgeParams): WillingnessResult {
  if (params.senderId === params.selfId) {
    return { shouldRespond: false, reason: "no_trigger" };
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

  const normalizedContent = params.content.toLowerCase();
  const hasKeyword = params.triggerKeywords.some((keyword) => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return false;
    }
    return normalizedContent.includes(normalizedKeyword);
  });

  if (hasKeyword) {
    return { shouldRespond: true, reason: "keyword_match" };
  }

  return { shouldRespond: false, reason: "no_trigger" };
}
