import type { HookType, HookPhase, HookHandler } from "./types";

export interface HookDecoratorOpts {
  type: HookType;
  phase: HookPhase;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

export interface StaticHookEntry extends HookDecoratorOpts {
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
