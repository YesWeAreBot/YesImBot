import type { ToolExecutionContext } from "../plugin/types";
import type { AgentEndSummary, Capabilities, RoundContext, Scenario } from "../runtime/contracts";

export enum HookType {
  Tool = "tool",
  Message = "message",
  Agent = "agent",
}

export enum HookPhase {
  Before = "before",
  After = "after",
  Error = "error",
}

/** @deprecated Use HookExecutionContext — will be removed in Phase 54 */
export interface HookContext<T = unknown> {
  type: HookType;
  phase: HookPhase;
  params: Readonly<T>;
  result?: unknown;
  error?: Error;
  traceId?: string;
}

export interface HookExecutionContext extends ToolExecutionContext {
  hookType: HookType;
  hookPhase: HookPhase;
}

export type AgentLifecycleBoundary = "start" | "end";

interface AgentLifecycleHookExecutionContextBase extends HookExecutionContext {
  hookType: HookType.Agent;
  roundContext: RoundContext;
  scenario: Scenario;
  capabilities: Capabilities;
  lifecycle: AgentLifecycleBoundary;
}

export interface AgentStartHookExecutionContext extends AgentLifecycleHookExecutionContextBase {
  hookPhase: HookPhase.Before;
  lifecycle: "start";
}

export interface AgentEndHookExecutionContext extends AgentLifecycleHookExecutionContextBase {
  hookPhase: HookPhase.After;
  lifecycle: "end";
  endSummary: AgentEndSummary;
}

export type AgentLifecycleHookExecutionContext =
  | AgentStartHookExecutionContext
  | AgentEndHookExecutionContext;

export interface HookTimeoutsConfig {
  tool?: number;
  message?: number;
  agent?: number;
}

export const DEFAULT_HOOK_TIMEOUTS: Required<HookTimeoutsConfig> = {
  tool: 3000,
  message: 1000,
  agent: 5000,
};

export type HookOutcome = "success" | "skipped";
export type HookFailureReason = "timeout" | "error";

export interface HookServiceConfig {
  hookTimeouts?: HookTimeoutsConfig;
}

export type BeforeHookResult<T> =
  | { modified: true; params: T }
  | { skip: true; result: unknown }
  | { modified: false };

export type HookHandler<T = unknown> = (ctx: HookContext<T>) => Promise<BeforeHookResult<T> | void>;

export interface HookDefinition<T = unknown> {
  id?: string;
  type: HookType;
  phase: HookPhase;
  handler: HookHandler<T>;
  timeout?: number;
  metadata?: Record<string, unknown>;
}
