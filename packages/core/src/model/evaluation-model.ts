import { Context } from "koishi";

import type { LoggerService } from "../logger";
import { BaseModel, formatModelIdentity } from "./base-model";
import { ModelConfig } from "./config";
import { evaluateQuestions, EvaluationQuestions, EvaluationRequestOptions, EvaluationResult } from "./evaluation-client";
import { observeUsageFetch } from "./usage";
import type { UsageOwner } from "./usage-owner";

export class EvaluationModel extends BaseModel {
    constructor(
        ctx: Context,
        private readonly provider: (model: string) => EvaluationRequestOptions,
        config: ModelConfig,
        private readonly fetch: typeof globalThis.fetch,
        logging: LoggerService,
        usageOwner?: UsageOwner,
    ) {
        super(ctx, config, `[评估模型] ${formatModelIdentity(config)}`, logging);
        this.fetch = observeUsageFetch(ctx, { provider: config.providerName ?? "未知", model: this.id, purpose: "评估" }, fetch, usageOwner);
    }

    public evaluate<Q extends EvaluationQuestions>(state: unknown, questions: Q, signal?: AbortSignal, timeoutMs = 3000): Promise<EvaluationResult<Q>> {
        return evaluateQuestions(this.provider(this.id), { state, questions }, { signal, timeoutMs, fetch: this.fetch });
    }
}
