import type { AssistantModelMessage, ToolModelMessage } from "@ai-sdk/provider-utils";
import type { JSONValue } from "ai";

import type { AthenaMessage } from "./athena-message";

export interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface SessionHeader {
  type: "session";
  version: number;
  id: string;
  channelKey: string;
  timestamp: string;
  modelId?: string;
}

export interface AssistantMessage extends AssistantModelMessage {
  role: "assistant";
}

export interface ToolResultMessage extends ToolModelMessage {
  role: "tool";
}

export type SessionMessage = AthenaMessage | AssistantModelMessage | ToolModelMessage;

export interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: SessionMessage;
}

export interface ActivationResultEntry extends SessionEntryBase {
  type: "activation_result";
  batchId: string;
  activated: boolean;
  reasons: string[];
}

export interface ResponseStatusEntry extends SessionEntryBase {
  type: "response_status";
  endReason: string;
  nextAction: string;
  stepsCompleted: number;
  durationMs: number;
}

export interface CompactionEntry extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
}

export interface ModelChangeSessionInfoEntry extends SessionEntryBase {
  type: "session_info";
  infoType: "model_change";
  provider: string;
  modelId: string;
}

export interface RuntimeStateSessionInfoEntry extends SessionEntryBase {
  type: "session_info";
  infoType: "runtime_state";
  provider: "runtime";
  modelId: string;
  stateType: string;
  data?: Record<string, JSONValue | undefined>;
}

export type SessionInfoEntry = ModelChangeSessionInfoEntry | RuntimeStateSessionInfoEntry;

export type SessionEntry =
  | SessionHeader
  | SessionMessageEntry
  | ActivationResultEntry
  | ResponseStatusEntry
  | CompactionEntry
  | SessionInfoEntry;
