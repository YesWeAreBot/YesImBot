import { randomUUID } from "crypto";

import { Context, Service } from "koishi";

import type { StaticHookEntry } from "./decorators";
import { DEFAULT_HOOK_TIMEOUTS, HookType } from "./types";
import type {
  HookDefinition,
  HookPhase,
  BeforeHookResult,
  HookServiceConfig,
  HookTimeoutsConfig,
  HookOutcome,
} from "./types";

interface RegisteredHook extends HookDefinition {
  ctx: Context;
}

declare module "koishi" {
  interface Context {
    "yesimbot.hook": HookService;
  }
}

export class HookService extends Service<HookServiceConfig> {
  static inject = [];

  private hooks = new Map<string, RegisteredHook>();
  private timeouts: Record<HookType, number>;
  private eventContext: Context;

  constructor(ctx: Context, hookConfig?: HookServiceConfig) {
    super(ctx, "yesimbot.hook", true);
    this.config = hookConfig ?? {};
    this.eventContext = ctx;
    this.logger = ctx.logger("yesimbot.hook");
    this.logger.level = this.config.debugLevel ?? this.config.logLevel ?? 2;
    const hookTimeouts: HookTimeoutsConfig = hookConfig?.hookTimeouts ?? {};
    this.timeouts = {
      [HookType.Tool]: hookTimeouts.tool ?? DEFAULT_HOOK_TIMEOUTS.tool,
      [HookType.Agent]: hookTimeouts.agent ?? DEFAULT_HOOK_TIMEOUTS.agent,
    };
  }

  register(ctx: Context, def: HookDefinition): () => void {
    const hookId = def.id || randomUUID();
    const registered: RegisteredHook = { ...def, id: hookId, ctx };

    this.hooks.set(hookId, registered);

    const source = typeof def.metadata?.source === "string" ? def.metadata.source : undefined;
    this.eventContext.emit("athena:hook.registered", hookId, def.type, def.phase, source);

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
    const traceValue = traceId ?? "-";

    for (const hook of hooks) {
      const snapshot = cloneHookParams(currentParams);
      const hookCtx = {
        type,
        phase: "before" as HookPhase,
        params: snapshot as Readonly<T>,
        traceId,
      };

      const hookId = hook.id ?? "unknown";
      const hookPhase = "before" as HookPhase;
      const startMs = Date.now();
      this.eventContext.emit("athena:hook.started", hookId, type, hookPhase, traceValue);

      try {
        const effectiveTimeout = timeout ?? hook.timeout ?? this.timeouts[type];
        const timeoutResult = Symbol("hook-timeout");
        const result = (await Promise.race([
          hook.handler(hookCtx) as Promise<BeforeHookResult<T> | void>,
          new Promise<typeof timeoutResult>((resolve) =>
            setTimeout(() => resolve(timeoutResult), effectiveTimeout),
          ),
        ])) as BeforeHookResult<T> | void | typeof timeoutResult;

        const durationMs = Date.now() - startMs;

        if (result === timeoutResult) {
          const reason = "timeout";
          this.eventContext.emit(
            "athena:hook.failed",
            hookId,
            type,
            hookPhase,
            traceValue,
            durationMs,
            reason,
          );
          this.logger.warn(
            `[${traceValue}] Hook ${hookId} (${type}/${hookPhase}) timed out after ${durationMs}ms`,
            {
              hookId,
              hookType: type,
              hookPhase,
              traceId: traceValue,
              durationMs,
              reason,
            },
          );
          continue;
        }

        if (result && typeof result === "object" && "skip" in result && result.skip) {
          const skipResult = result as Extract<BeforeHookResult<T>, { skip: true }>;
          const outcome: HookOutcome = "skipped";
          this.eventContext.emit(
            "athena:hook.completed",
            hookId,
            type,
            hookPhase,
            traceValue,
            durationMs,
            outcome,
          );
          this.logger.debug(
            `[${traceValue}] Hook ${hookId} (${type}/${hookPhase}) completed in ${durationMs}ms`,
            {
              hookId,
              hookType: type,
              hookPhase,
              traceId: traceValue,
              durationMs,
              outcome,
            },
          );
          return { params: currentParams, skipped: true, result: skipResult.result };
        }

        if (result && typeof result === "object" && "modified" in result && result.modified) {
          const modifiedResult = result as Extract<BeforeHookResult<T>, { modified: true }>;
          currentParams = modifiedResult.params;
        }

        const outcome: HookOutcome = "success";
        this.eventContext.emit(
          "athena:hook.completed",
          hookId,
          type,
          hookPhase,
          traceValue,
          durationMs,
          outcome,
        );
        this.logger.debug(
          `[${traceValue}] Hook ${hookId} (${type}/${hookPhase}) completed in ${durationMs}ms`,
          {
            hookId,
            hookType: type,
            hookPhase,
            traceId: traceValue,
            durationMs,
            outcome,
          },
        );
      } catch (error) {
        const durationMs = Date.now() - startMs;
        const reason = error instanceof Error ? error.message : String(error);
        this.eventContext.emit(
          "athena:hook.failed",
          hookId,
          type,
          hookPhase,
          traceValue,
          durationMs,
          reason,
          error instanceof Error ? error : undefined,
        );
        this.logger.warn(
          `[${traceValue}] Hook ${hookId} (${type}/${hookPhase}) failed after ${durationMs}ms: ${reason}`,
          {
            hookId,
            hookType: type,
            hookPhase,
            traceId: traceValue,
            durationMs,
            reason,
          },
        );
      }
    }

    return { params: currentParams, skipped: false };
  }

  async executeAgentStart<T>(
    params: T,
    traceId?: string,
    timeout?: number,
  ): Promise<{ params: T; skipped: boolean; result?: unknown }> {
    return this.executeBefore(HookType.Agent, params, traceId, timeout);
  }

  async executeAgentEnd<T extends { endSummary: unknown }>(
    params: T,
    traceId?: string,
    timeout?: number,
  ): Promise<void> {
    return this.executeAfter(HookType.Agent, params, params.endSummary, traceId, timeout);
  }

  async executeAfter<T>(
    type: HookType,
    params: T,
    result: unknown,
    traceId?: string,
    timeout?: number,
  ): Promise<void> {
    const hooks = this.getHooks(type, "after" as HookPhase);
    const traceValue = traceId ?? "-";

    for (const hook of hooks) {
      const snapshot = cloneHookParams(params);
      const hookCtx = {
        type,
        phase: "after" as HookPhase,
        params: snapshot as Readonly<T>,
        result,
        traceId,
      };

      const hookId = hook.id ?? "unknown";
      const hookPhase = "after" as HookPhase;
      const startMs = Date.now();
      this.eventContext.emit("athena:hook.started", hookId, type, hookPhase, traceValue);

      try {
        const effectiveTimeout = timeout ?? hook.timeout ?? this.timeouts[type];
        const timeoutResult = Symbol("hook-timeout");
        const raceResult = (await Promise.race([
          hook.handler(hookCtx) as Promise<BeforeHookResult<T> | void>,
          new Promise<typeof timeoutResult>((resolve) =>
            setTimeout(() => resolve(timeoutResult), effectiveTimeout),
          ),
        ])) as void | typeof timeoutResult | BeforeHookResult<T>;
        const durationMs = Date.now() - startMs;

        if (raceResult === timeoutResult) {
          const reason = "timeout";
          this.eventContext.emit(
            "athena:hook.failed",
            hookId,
            type,
            hookPhase,
            traceValue,
            durationMs,
            reason,
          );
          this.logger.warn(
            `[${traceValue}] Hook ${hookId} (${type}/${hookPhase}) timed out after ${durationMs}ms`,
            {
              hookId,
              hookType: type,
              hookPhase,
              traceId: traceValue,
              durationMs,
              reason,
            },
          );
          continue;
        }

        const outcome: HookOutcome = "success";
        this.eventContext.emit(
          "athena:hook.completed",
          hookId,
          type,
          hookPhase,
          traceValue,
          durationMs,
          outcome,
        );
        this.logger.debug(
          `[${traceValue}] Hook ${hookId} (${type}/${hookPhase}) completed in ${durationMs}ms`,
          {
            hookId,
            hookType: type,
            hookPhase,
            traceId: traceValue,
            durationMs,
            outcome,
          },
        );
      } catch (error) {
        const durationMs = Date.now() - startMs;
        const reason = error instanceof Error ? error.message : String(error);
        this.eventContext.emit(
          "athena:hook.failed",
          hookId,
          type,
          hookPhase,
          traceValue,
          durationMs,
          reason,
          error instanceof Error ? error : undefined,
        );
        this.logger.warn(
          `[${traceValue}] Hook ${hookId} (${type}/${hookPhase}) failed after ${durationMs}ms: ${reason}`,
          {
            hookId,
            hookType: type,
            hookPhase,
            traceId: traceValue,
            durationMs,
            reason,
          },
        );
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
    const traceValue = traceId ?? "-";

    for (const hook of hooks) {
      const snapshot = cloneHookParams(params);
      const hookCtx = {
        type,
        phase: "error" as HookPhase,
        params: snapshot as Readonly<T>,
        error,
        traceId,
      };

      const hookId = hook.id ?? "unknown";
      const hookPhase = "error" as HookPhase;
      const startMs = Date.now();
      this.eventContext.emit("athena:hook.started", hookId, type, hookPhase, traceValue);

      try {
        const effectiveTimeout = timeout ?? hook.timeout ?? this.timeouts[type];
        const timeoutResult = Symbol("hook-timeout");
        const raceResult = (await Promise.race([
          hook.handler(hookCtx) as Promise<BeforeHookResult<T> | void>,
          new Promise<typeof timeoutResult>((resolve) =>
            setTimeout(() => resolve(timeoutResult), effectiveTimeout),
          ),
        ])) as void | typeof timeoutResult | BeforeHookResult<T>;
        const durationMs = Date.now() - startMs;

        if (raceResult === timeoutResult) {
          const reason = "timeout";
          this.eventContext.emit(
            "athena:hook.failed",
            hookId,
            type,
            hookPhase,
            traceValue,
            durationMs,
            reason,
          );
          this.logger.warn(
            `[${traceValue}] Hook ${hookId} (${type}/${hookPhase}) timed out after ${durationMs}ms`,
            {
              hookId,
              hookType: type,
              hookPhase,
              traceId: traceValue,
              durationMs,
              reason,
            },
          );
          continue;
        }

        const outcome: HookOutcome = "success";
        this.eventContext.emit(
          "athena:hook.completed",
          hookId,
          type,
          hookPhase,
          traceValue,
          durationMs,
          outcome,
        );
        this.logger.debug(
          `[${traceValue}] Hook ${hookId} (${type}/${hookPhase}) completed in ${durationMs}ms`,
          {
            hookId,
            hookType: type,
            hookPhase,
            traceId: traceValue,
            durationMs,
            outcome,
          },
        );
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const reason = err instanceof Error ? err.message : String(err);
        this.eventContext.emit(
          "athena:hook.failed",
          hookId,
          type,
          hookPhase,
          traceValue,
          durationMs,
          reason,
          err instanceof Error ? err : undefined,
        );
        this.logger.warn(
          `[${traceValue}] Hook ${hookId} (${type}/${hookPhase}) failed after ${durationMs}ms: ${reason}`,
          {
            hookId,
            hookType: type,
            hookPhase,
            traceId: traceValue,
            durationMs,
            reason,
          },
        );
      }
    }
  }

  registerFromDecorators(ctx: Context, instance: object): Array<() => void> {
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    const staticHooks = (proto.__staticHooks as StaticHookEntry[] | undefined) ?? [];
    const disposers: Array<() => void> = [];

    for (const entry of staticHooks) {
      const handler = (instance as Record<string, unknown>)[entry.methodKey] as (
        ctx: Parameters<HookDefinition["handler"]>[0],
      ) => Promise<BeforeHookResult<unknown> | void>;

      const dispose = this.register(ctx, {
        type: entry.type,
        phase: entry.phase,
        handler: handler.bind(instance),
        timeout: entry.timeout,
        metadata: entry.metadata,
      });
      disposers.push(dispose);
    }

    return disposers;
  }
}

function cloneHookParams<T>(params: T): T {
  try {
    return structuredClone(params);
  } catch (error) {
    return deepClonePreserveFunctions(params, new Map());
  }
}

function deepClonePreserveFunctions<T>(value: T, seen: Map<object, unknown>): T {
  if (typeof value !== "object" || value === null) return value;
  const existing = seen.get(value as object);
  if (existing) return existing as T;

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value as object, clone);
    for (const item of value) {
      clone.push(deepClonePreserveFunctions(item, seen));
    }
    return clone as T;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }

  const clone: Record<string, unknown> = {};
  seen.set(value as object, clone);
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    clone[key] = deepClonePreserveFunctions(entry, seen);
  }
  return clone as T;
}
