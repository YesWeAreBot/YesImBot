import {
  evaluateRuntimeWillingnessHeuristic,
  type RuntimeWillingnessHeuristicParams,
} from "../willingness";
import type { ChannelKey, WillingnessResult } from "../types/runtime-types";
import type {
  AthenaChannelEvent,
  AthenaEvent,
  AthenaInternalSignalEvent,
  AthenaMessageEvent,
  AthenaPlatformNoticeEvent,
} from "./athena-event";

export interface EventBatch {
  batchId: string;
  channelKey: ChannelKey;
  events: AthenaEvent[];
}

export type ActivationReasonCode =
  | WillingnessResult["reason"]
  | "channel_event"
  | "platform_notice"
  | "internal_signal";

export interface ActivationReason {
  source: "policy" | "event";
  code: ActivationReasonCode;
  detail?: string;
}

export interface ActivationResult {
  batchId: string;
  activated: boolean;
  reasons: ActivationReason[];
}

function isMessageEvent(event: AthenaEvent): event is AthenaMessageEvent {
  return event.kind === "message";
}

function toHeuristicParams(event: AthenaMessageEvent): RuntimeWillingnessHeuristicParams {
  return {
    isDirect: event.isDirect,
    atSelf: event.atSelf,
    isReplyToBot: event.isReplyToBot,
    selfId: "",
    senderId: event.sender.userId,
  };
}

function toPolicyReason(reason: WillingnessResult["reason"]): ActivationReason {
  return {
    source: "policy",
    code: reason,
  };
}

function evaluateEvent(
  event: AthenaChannelEvent | AthenaPlatformNoticeEvent | AthenaInternalSignalEvent,
): ActivationReason {
  if (event.kind === "internal_signal") {
    return {
      source: "event",
      code: "internal_signal",
      detail: event.signalType,
    };
  }

  if (event.kind === "platform_notice") {
    return {
      source: "event",
      code: "platform_notice",
      detail: event.noticeType,
    };
  }

  return {
    source: "event",
    code: "channel_event",
    detail: event.eventType,
  };
}

export const Activation = {
  evaluate(batch: EventBatch): ActivationResult {
    const reasons: ActivationReason[] = [];

    for (const event of batch.events) {
      if (isMessageEvent(event)) {
        const heuristic = evaluateRuntimeWillingnessHeuristic(toHeuristicParams(event));
        reasons.push(toPolicyReason(heuristic?.reason ?? "no_trigger"));
        continue;
      }

      reasons.push(evaluateEvent(event));
    }

    return {
      batchId: batch.batchId,
      activated: reasons.some((reason) =>
        reason.code === "direct_message" ||
        reason.code === "at_self" ||
        reason.code === "llm_judge" ||
        reason.code === "platform_notice" ||
        reason.code === "internal_signal",
      ),
      reasons,
    };
  },
};
