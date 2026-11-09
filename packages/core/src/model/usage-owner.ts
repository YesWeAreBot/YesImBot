import type { Context } from "koishi";

/** Per-model-service identity; its context supplies persistence and disposal. */
export interface UsageOwner {
    context: Context;
}

const owners = new WeakMap<Context, UsageOwner>();

/** Register an explicit owner without resolving the facade while it is being constructed. */
export function bindUsageOwner(ctx: Context, owner: UsageOwner): void {
    owners.set(ctx, owner);
}

export function resolveUsageOwner(ctx: Context, explicitOwner?: UsageOwner): UsageOwner | undefined {
    return explicitOwner ?? owners.get(ctx);
}
