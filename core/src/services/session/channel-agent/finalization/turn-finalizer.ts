import type { SessionManager } from "../../session-manager";
import type { ResponseEndReason, ResponseEndRecord } from "../../types";

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

  nextAction(input: {
    hasQueuedResponse: boolean;
    hasAccumulatedMessages: boolean;
  }): "run-queued" | "re-evaluate-accumulated" | "idle" {
    if (input.hasQueuedResponse) {
      return "run-queued";
    }
    if (input.hasAccumulatedMessages) {
      return "re-evaluate-accumulated";
    }
    return "idle";
  }
}
