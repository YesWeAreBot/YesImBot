import type { AgentSessionConfig } from "@yesimbot/agent";

import type { RuntimeSettings } from "./settings.js";

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
