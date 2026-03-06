import { randomUUID } from "crypto";

import { Context, Service } from "koishi";

import type { StaticHookEntry } from "./decorators";
import type { HookDefinition, HookType, HookPhase, HookContext, BeforeHookResult } from "./types";

interface RegisteredHook extends HookDefinition {
  ctx: Context;
}

declare module "koishi" {
  interface Context {
    hook: HookService;
  }
}

export class HookService extends Service {
  static inject = [];

  private hooks = new Map<string, RegisteredHook>();

  constructor(ctx: Context) {
    super(ctx, "hook", true);
  }

  register(ctx: Context, def: HookDefinition): () => void {
    const hookId = def.id || randomUUID();
    const registered: RegisteredHook = { ...def, id: hookId, ctx };

    this.hooks.set(hookId, registered);

    ctx.on("dispose", () => {
      this.hooks.delete(hookId);
    });

    return () => this.hooks.delete(hookId);
  }

  getHooks(type: HookType, phase: HookPhase): RegisteredHook[] {
    return Array.from(this.hooks.values()).filter((h) => h.type === type && h.phase === phase);
  }

  async executeBefore<T>(
    type: HookType,
    params: T,
    traceId?: string,
    timeout?: number,
  ): Promise<{ params: T; skipped: boolean; result?: unknown }> {
    const hooks = this.getHooks(type, "before" as HookPhase);
    let currentParams = params;

    for (const hook of hooks) {
      const hookCtx: HookContext<T> = {
        type,
        phase: "before" as HookPhase,
        params: currentParams,
        traceId,
      };

      try {
        const effectiveTimeout = timeout ?? hook.timeout ?? 5000;
        const result = (await Promise.race([
          hook.handler(hookCtx),
          new Promise<undefined>((resolve) =>
            setTimeout(() => resolve(undefined), effectiveTimeout),
          ),
        ])) as BeforeHookResult<T> | void;

        if (!result) continue;

        if ("skip" in result && result.skip) {
          return { params: currentParams, skipped: true, result: result.result };
        }

        if ("modified" in result && result.modified) {
          currentParams = result.params;
        }
      } catch (error) {
        this.logger.warn(`Hook ${hook.id} failed:`, error);
      }
    }

    return { params: currentParams, skipped: false };
  }

  async executeAfter<T>(
    type: HookType,
    params: T,
    result: unknown,
    traceId?: string,
    timeout?: number,
  ): Promise<void> {
    const hooks = this.getHooks(type, "after" as HookPhase);

    for (const hook of hooks) {
      const hookCtx: HookContext<T> = {
        type,
        phase: "after" as HookPhase,
        params,
        result,
        traceId,
      };

      try {
        const effectiveTimeout = timeout ?? hook.timeout ?? 5000;
        await Promise.race([
          hook.handler(hookCtx),
          new Promise((resolve) => setTimeout(resolve, effectiveTimeout)),
        ]);
      } catch (error) {
        this.logger.warn(`Hook ${hook.id} failed:`, error);
      }
    }
  }

  async executeError<T>(
    type: HookType,
    params: T,
    error: Error,
    traceId?: string,
    timeout?: number,
  ): Promise<void> {
    const hooks = this.getHooks(type, "error" as HookPhase);

    for (const hook of hooks) {
      const hookCtx: HookContext<T> = { type, phase: "error" as HookPhase, params, error, traceId };

      try {
        const effectiveTimeout = timeout ?? hook.timeout ?? 5000;
        await Promise.race([
          hook.handler(hookCtx),
          new Promise((resolve) => setTimeout(resolve, effectiveTimeout)),
        ]);
      } catch (err) {
        this.logger.warn(`Hook ${hook.id} failed:`, err);
      }
    }
  }
}
