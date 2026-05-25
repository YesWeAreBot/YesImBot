import type { AgentSessionConfig } from "@yesimbot/agent";
import { SessionManager } from "@yesimbot/agent/session";

import type { DeliveryEventDetails } from "./delivery/index.js";
import { RuntimeSettings } from "./settings-manager.js";

export function buildAgentSessionConfig(
  settings: RuntimeSettings,
): Pick<
  AgentSessionConfig,
  | "contextWindow"
  | "compactionSettings"
  | "compactionPrompts"
  | "retrySettings"
  | "steeringMode"
  | "followUpMode"
> {
  return {
    contextWindow: settings.contextWindow,
    compactionSettings: settings.compaction,
    compactionPrompts: settings.compaction.prompts,
    retrySettings: settings.retry,
    steeringMode: settings.steeringMode,
    followUpMode: settings.followUpMode,
  };
}

export function persistDeliveryEvents(
  sessionManager: SessionManager,
  events: DeliveryEventDetails[],
): void {
  for (const event of events) {
    sessionManager.appendCustomEntry("athena:delivery_event", {
      display: false,
      details: toSerializableDeliveryEvent(event),
    });
  }
}

function toSerializableDeliveryEvent(event: DeliveryEventDetails): DeliveryEventDetails {
  return {
    ...event,
    ...(event.error !== undefined && { error: serializeError(event.error) }),
  };
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack !== undefined && { stack: error.stack }),
    };
  }
  return error;
}
