import type { Context } from "koishi";

export enum HookType {
  Tool = "tool",
  Agent = "agent",
}

export enum HookPhase {
  Before = "before",
  After = "after",
  Error = "error",
}

interface PublicHookContextBase {
  roundContext: unknown;
  scenario: unknown;
  capabilities: unknown;
  percept?: unknown;
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
  endSummary: unknown;
  traceId?: string;
}

export interface HookExecutionContext {
  hookType: HookType;
  hookPhase: HookPhase;
}

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

export type HookContext<TParams = unknown> =
  | ToolBeforeHookContext<TParams>
  | ToolAfterHookContext<TParams>
  | ToolErrorHookContext<TParams>
  | AgentStartHookContext<TParams>
  | AgentEndHookContext<TParams>;

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

export interface HookDecoratorOpts {
  type: HookType;
  phase: HookPhase;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

interface StaticHookEntry extends HookDecoratorOpts {
  methodKey: string;
  handler?: HookHandler<unknown>;
}

export function Hook(opts: HookDecoratorOpts) {
  return (target: unknown, propertyKey: string | symbol, _descriptor?: PropertyDescriptor) => {
    const proto = target as Record<string, unknown>;
    if (!proto.__staticHooks) proto.__staticHooks = [];
    (proto.__staticHooks as StaticHookEntry[]).push({
      ...opts,
      methodKey: String(propertyKey),
    });
  };
}

interface HookRuntimeRegistrar {
  register(ctx: Context, def: HookDefinition): () => void;
}

type HookRuntimeContext = Context & {
  "yesimbot.hook"?: HookRuntimeRegistrar;
};

export function registerHook(
  ctx: Context,
  def: HookDefinition,
): () => void {
  const hookService = (ctx as HookRuntimeContext)["yesimbot.hook"];
  if (!hookService) {
    throw new Error("yesimbot.hook service is not available on context");
  }
  return hookService.register(ctx, def);
}
