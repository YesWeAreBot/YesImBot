/* eslint-disable ts/no-require-imports */
/* eslint-disable ts/no-redeclare */
import type { ChatModelConfig, SharedConfig } from "@yesimbot/shared-model";
import type { Context } from "koishi";
import { ChatModelAbility, ModelType, SharedProvider } from "@yesimbot/shared-model";
import { Schema } from "koishi";

export interface ModelConfig extends ChatModelConfig {
    headers?: Record<string, string>;
    reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
    max_completion_tokens?: number;
}

export interface Config extends SharedConfig<ModelConfig> {
    baseURL: string;
    apiKey: string;
    proxy?: string;
}

export const name = "provider-openai";
export const usage = "";
export const inject = ["yesimbot.model"];

export const Config: Schema<Config> = Schema.object({
    baseURL: Schema.string().default("https://api.openai.com/v1/"),
    apiKey: Schema.string().role("secret").required(),
    proxy: Schema.string().default(""),
    retryDefault: Schema.number().min(0).default(3),
    retryDelayDefault: Schema.number().min(0).default(1000),
    modelConfig: Schema.object({
        temperature: Schema.number().min(0).max(2).step(0.01).role("slider").default(1),
        topP: Schema.number().min(0).max(1).step(0.01).role("slider").default(1),
        frequencyPenalty: Schema.number().min(-2).max(2).step(0.01).role("slider").default(0),
        presencePenalty: Schema.number().min(-2).max(2).step(0.01).role("slider").default(0),
        headers: Schema.dict(String).role("table").default({}),
        reasoning_effort: Schema.union(["none", "minimal", "low", "medium", "high", "xhigh"]).default("medium"),
        max_completion_tokens: Schema.number(),
    }).description("OpenAI 默认请求参数"),
}).i18n({
    "zh-CN": require("./locales/zh-CN.yml")._config,
    "en-US": require("./locales/en-US.yml")._config,
});

class OpenAIProvider extends SharedProvider<any, ModelConfig> {
}

export function apply(ctx: Context, config: Config) {
    ctx.on("ready", () => {
        const registry = ctx.get("yesimbot.model");
        if (!registry) {
            ctx.logger("provider-openai").warn("ProviderRegistry 未就绪，跳过注册");
            return;
        }

        const providerName = "openai";

        const rawProvider = {
            chat(model: string) {
                return {
                    baseURL: config.baseURL,
                    apiKey: config.apiKey,
                    model,
                };
            },
            embed(model: string) {
                return {
                    baseURL: config.baseURL,
                    apiKey: config.apiKey,
                    model,
                };
            },
        };

        try {
            registry.setProvider(
                providerName,
                new OpenAIProvider(providerName, rawProvider, config, { proxy: config.proxy }),
            );
        } catch (err: any) {
            ctx.logger("provider-openai").warn(`注册 provider 失败: ${err?.message ?? String(err)}`);
        }

        // Minimal built-in catalog for better UX (still allows custom model strings).
        try {
            registry.addChatModels(providerName, [
                {
                    modelId: "gpt-4o",
                    modelType: ModelType.Chat,
                    abilities: [ChatModelAbility.ImageInput, ChatModelAbility.ToolUsage],
                },
                {
                    modelId: "gpt-4o-mini",
                    modelType: ModelType.Chat,
                    abilities: [ChatModelAbility.ImageInput, ChatModelAbility.ToolUsage],
                },
                {
                    modelId: "gpt-4.1",
                    modelType: ModelType.Chat,
                    abilities: [ChatModelAbility.ToolUsage],
                },
                {
                    modelId: "gpt-4.1-mini",
                    modelType: ModelType.Chat,
                    abilities: [ChatModelAbility.ToolUsage],
                },
            ]);

            registry.addEmbedModels(providerName, [
                { modelId: "text-embedding-3-small", modelType: ModelType.Embed, dimension: 1536 },
                { modelId: "text-embedding-3-large", modelType: ModelType.Embed, dimension: 3072 },
            ]);
        } catch (err: any) {
            ctx.logger("provider-openai").warn(`注册模型目录失败: ${err?.message ?? String(err)}`);
        }
    });
}
