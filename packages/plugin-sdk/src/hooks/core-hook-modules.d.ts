declare module "koishi-plugin-yesimbot/services/hook/decorators" {
  import type { HookPhase, HookType } from "koishi-plugin-yesimbot/services/hook/types";

  export interface HookDecoratorOpts {
    type: HookType;
    phase: HookPhase;
    timeout?: number;
    metadata?: Record<string, unknown>;
  }

  export function Hook(opts: HookDecoratorOpts): MethodDecorator;
}

declare module "koishi-plugin-yesimbot/services/hook/types" {
  export interface ToolBeforeHookContext<TParams = unknown> {
    hookType: HookType.Tool;
    hookPhase: HookPhase.Before;
    roundContext: unknown;
    scenario: unknown;
    capabilities: unknown;
    percept?: unknown;
    params: Readonly<TParams>;
    traceId?: string;
  }

  export interface ToolAfterHookContext<TParams = unknown> {
    hookType: HookType.Tool;
    hookPhase: HookPhase.After;
    roundContext: unknown;
    scenario: unknown;
    capabilities: unknown;
    percept?: unknown;
    params: Readonly<TParams>;
    result: unknown;
    traceId?: string;
  }

  export interface ToolErrorHookContext<TParams = unknown> {
    hookType: HookType.Tool;
    hookPhase: HookPhase.Error;
    roundContext: unknown;
    scenario: unknown;
    capabilities: unknown;
    percept?: unknown;
    params: Readonly<TParams>;
    error: Error;
    traceId?: string;
  }

  export interface AgentStartHookContext<TParams = unknown> {
    hookType: HookType.Agent;
    hookPhase: HookPhase.Before;
    lifecycle: "start";
    roundContext: unknown;
    scenario: unknown;
    capabilities: unknown;
    percept?: unknown;
    params: Readonly<TParams>;
    traceId?: string;
  }

  export interface AgentEndHookContext<TParams = unknown> {
    hookType: HookType.Agent;
    hookPhase: HookPhase.After;
    lifecycle: "end";
    roundContext: unknown;
    scenario: unknown;
    capabilities: unknown;
    percept?: unknown;
    params: Readonly<TParams>;
    endSummary: unknown;
    traceId?: string;
  }

  export type HookContext<TParams = unknown> =
    | ToolBeforeHookContext<TParams>
    | ToolAfterHookContext<TParams>
    | ToolErrorHookContext<TParams>
    | AgentStartHookContext<TParams>
    | AgentEndHookContext<TParams>;

  export interface HookExecutionContext {
    hookType: HookType;
    hookPhase: HookPhase;
  }

  export type AgentLifecycleBoundary = "start" | "end";

  export interface AgentStartHookExecutionContext extends HookExecutionContext {
    hookType: HookType.Agent;
    hookPhase: HookPhase.Before;
    lifecycle: "start";
  }

  export interface AgentEndHookExecutionContext extends HookExecutionContext {
    hookType: HookType.Agent;
    hookPhase: HookPhase.After;
    lifecycle: "end";
    endSummary: unknown;
  }

  export type AgentLifecycleHookExecutionContext =
    | AgentStartHookExecutionContext
    | AgentEndHookExecutionContext;

  export enum HookType {
    Tool = "tool",
    Agent = "agent",
  }

  export enum HookPhase {
    Before = "before",
    After = "after",
    Error = "error",
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
}
