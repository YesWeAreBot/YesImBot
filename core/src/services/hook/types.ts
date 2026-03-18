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

export interface HookContext<T = unknown> {
  type: HookType;
  phase: HookPhase;
  params: T;
  result?: unknown;
  error?: Error;
  traceId?: string;
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
