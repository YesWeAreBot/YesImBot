import type {
  AgentEndSummary,
  Percept,
  Capabilities,
  RoundContext,
  Scenario,
} from "../../runtime/contracts";
import type { RuntimeToolExecutionContext } from "../plugin/types";

export enum HookType {
  Tool = "tool",
  Agent = "agent",
}

export enum HookPhase {
  Before = "before",
  After = "after",
  Error = "error",
}

export interface HookExecutionContext extends RuntimeToolExecutionContext {
  hookType: HookType;
  hookPhase: HookPhase;
}

interface PublicHookContextBase {
  roundContext: RoundContext;
  scenario: Scenario;
  capabilities: Capabilities;
  percept?: Percept;
}

export interface ToolBeforeHookContext<TParams = unknown> extends PublicHookContextBase {
  hookType: HookType.Tool;
  hookPhase: HookPhase.Before;
  params: Readonly<TParams>;
  traceId?: string;
}

export interface ToolAfterHookContext<TParams = unknown> extends PublicHookContextBase {
  hookType: HookType.Tool;
  hookPhase: HookPhase.After;
  params: Readonly<TParams>;
  result: unknown;
  traceId?: string;
}

export interface ToolErrorHookContext<TParams = unknown> extends PublicHookContextBase {
  hookType: HookType.Tool;
  hookPhase: HookPhase.Error;
  params: Readonly<TParams>;
  error: Error;
  traceId?: string;
}

export interface AgentStartHookContext<TParams = unknown> extends PublicHookContextBase {
  hookType: HookType.Agent;
  hookPhase: HookPhase.Before;
  lifecycle: "start";
  params: Readonly<TParams>;
  traceId?: string;
}

export interface AgentEndHookContext<TParams = unknown> extends PublicHookContextBase {
  hookType: HookType.Agent;
  hookPhase: HookPhase.After;
  lifecycle: "end";
  params: Readonly<TParams>;
  endSummary: AgentEndSummary;
  traceId?: string;
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

export type RuntimeToolBeforeHookContext<TParams = unknown> = ToolBeforeHookContext<TParams> &
  RuntimeToolExecutionContext;

export type RuntimeToolAfterHookContext<TParams = unknown> = ToolAfterHookContext<TParams> &
  RuntimeToolExecutionContext;

export type RuntimeToolErrorHookContext<TParams = unknown> = ToolErrorHookContext<TParams> &
  RuntimeToolExecutionContext;

export type RuntimeAgentStartHookContext<TParams = unknown> = AgentStartHookContext<TParams> &
  RuntimeToolExecutionContext;

export type RuntimeAgentEndHookContext<TParams = unknown> = AgentEndHookContext<TParams> &
  RuntimeToolExecutionContext;

export type RuntimeHookContext<TParams = unknown> =
  | RuntimeToolBeforeHookContext<TParams>
  | RuntimeToolAfterHookContext<TParams>
  | RuntimeToolErrorHookContext<TParams>
  | RuntimeAgentStartHookContext<TParams>
  | RuntimeAgentEndHookContext<TParams>;

export type HookContext<T = unknown> = RuntimeHookContext<T>;

export interface HookTimeoutsConfig {
  tool?: number;
  agent?: number;
}

export const DEFAULT_HOOK_TIMEOUTS: Required<HookTimeoutsConfig> = {
  tool: 3000,
  agent: 5000,
};

export type HookOutcome = "success" | "skipped";
export type HookFailureReason = "timeout" | "error";

export interface HookServiceConfig {
  hookTimeouts?: HookTimeoutsConfig;
  logLevel?: number;
  debugLevel?: number;
}

export type BeforeHookResult<T> =
  | { modified: true; params: T }
  | { skip: true; result: unknown }
  | { modified: false };

export type HookHandler<T = unknown> = (ctx: {
  type: HookType;
  phase: HookPhase;
  params: Readonly<T>;
  result?: unknown;
  error?: Error;
  traceId?: string;
}) => Promise<BeforeHookResult<T> | void>;

export interface HookDefinition<T = unknown> {
  id?: string;
  type: HookType;
  phase: HookPhase;
  handler: HookHandler<T>;
  timeout?: number;
  metadata?: Record<string, unknown>;
}
