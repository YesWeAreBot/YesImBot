import type { Context } from "koishi";
import { Services } from "../../shared/constants";

/** Per-model-service identity; its context supplies persistence and disposal. */
export interface UsageOwner {
    context: Context;
}

export function resolveUsageOwner(ctx: Context, explicitOwner?: UsageOwner): UsageOwner | undefined {
    // Model-service internals cannot inject their own service. Commands may resolve
    // it through their declared dependency; transports receive the owner directly.
    return explicitOwner ?? (ctx[Services.Model] as any)?.usageOwner;
}
