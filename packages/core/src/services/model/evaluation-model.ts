import { Context } from "koishi";
import { BaseModel } from "./base-model";
import { ModelConfig } from "./config";
import { evaluateQuestions, EvaluationQuestions, EvaluationRequestOptions, EvaluationResult } from "./evaluation-client";

export class EvaluationModel extends BaseModel {
    constructor(
        ctx: Context,
        private readonly provider: (model: string) => EvaluationRequestOptions,
        config: ModelConfig,
        private readonly fetch: typeof globalThis.fetch
    ) {
        super(ctx, config, `[评估模型] [${config.modelId}]`);
    }

    public evaluate<Q extends EvaluationQuestions>(state: unknown, questions: Q, signal?: AbortSignal, timeoutMs = 3000): Promise<EvaluationResult<Q>> {
        return evaluateQuestions(this.provider(this.id), { state, questions }, { signal, timeoutMs, fetch: this.fetch });
    }
}
