import type { HookType, HookPhase, HookHandler } from "./types";

export interface HookDecoratorOpts<T = unknown> {
  type: HookType;
  phase: HookPhase;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

export interface StaticHookEntry<T = unknown> extends HookDecoratorOpts<T> {
  methodKey: string;
  handler?: HookHandler<T>;
}

export function Hook<T = unknown>(opts: HookDecoratorOpts<T>): MethodDecorator {
  return (target, propertyKey) => {
    const proto = target as Record<string, unknown>;
    if (!proto.__staticHooks) proto.__staticHooks = [];
    (proto.__staticHooks as StaticHookEntry[]).push({
      ...opts,
      methodKey: String(propertyKey),
    });
  };
}
