import type { EvaluationProvider, SharedConfig } from "@yesimbot/shared-model";
import type { Context } from "koishi";
import { ModelType, normalizeBaseURL, SharedProvider } from "@yesimbot/shared-model";
import { Schema } from "koishi";

export interface Config extends SharedConfig<never> {
    name: string;
    models: string[];
}

export default class TypeSafeProvider extends SharedProvider<EvaluationProvider> {
    static name = "provider-typesafe";
    static inject = ["yesimbot.model"];
    static reusable = true;
    static Config: Schema<Config> = Schema.object({
        name: Schema.string().default("typesafe").description("Provider 实例名称"),
        baseURL: Schema.string().default("https://api.typesafe.ai/v1").description("TypeSafe API 地址，包含 /v1"),
        apiKey: Schema.string().role("secret").required().description("TypeSafe API 密钥"),
        models: Schema.array(Schema.string()).role("table").default(["jev-1.13.0", "jev-latest"]).description("可用的判断模型 ID"),
    });

    constructor(ctx: Context, config: Config) {
        const baseURL = normalizeBaseURL(config.baseURL) || config.baseURL.replace(/\/+$/, "");
        const provider: EvaluationProvider = {
            evaluate: model => ({ baseURL, apiKey: config.apiKey, model }),
        };
        super(config.name, config, provider);
        let registered = false;
        ctx.on("ready", () => {
            const registry = ctx.get("yesimbot.model");
            if (!registry)
                return;
            try {
                registry.setProvider(this.name, this);
                registered = true;
                registry.addEvaluationModels(this.name, config.models.filter(Boolean).map(modelId => ({ modelId, modelType: ModelType.Evaluation })));
            } catch {
                // A duplicate instance must not alter the existing registration.
            }
        });
        ctx.on("dispose", () => {
            if (registered) {
                ctx.get("yesimbot.model")?.removeProvider(this.name);
                registered = false;
            }
        });
    }
}
