import type { SessionManager } from "../../session-manager";
import type { ResponseEndReason, ResponseEndRecord } from "../../types";
import type { TurnOutcomeSelection } from "../types";

export class TurnFinalizer {
  resolveEndReason(input: {
    aborted: boolean;
    timedOut: boolean;
    protocolError: boolean;
    heartbeatRequested: boolean;
    sendFailure: boolean;
    thrownError?: string;
  }): ResponseEndReason {
    if (input.timedOut) {
      return "timeout";
    }

    if (input.aborted) {
      return "abort";
    }

    if (input.protocolError) {
      return "protocol_error";
    }

    if (input.sendFailure || Boolean(input.thrownError)) {
      return "exception";
    }

    if (input.heartbeatRequested) {
      return "heartbeat_continuation";
    }

    return "normal";
  }

  persist(sessionManager: SessionManager, record: ResponseEndRecord): void {
    sessionManager.appendCustomEntry<ResponseEndRecord>("response_end", record);
  }

  selectOutcome(input: {
    endReason: ResponseEndReason;
    hasPendingFollowUp: boolean;
    thrownError?: string;
  }): TurnOutcomeSelection {
    if (
      input.endReason === "timeout" ||
      input.endReason === "protocol_error" ||
      input.endReason === "exception"
    ) {
      return {
        nextOutcome: "blocked",
        blockedReason: input.thrownError ?? input.endReason,
      };
    }

    if (input.hasPendingFollowUp) {
      return { nextOutcome: "follow_up" };
    }

    return { nextOutcome: "idle" };
  }
}
