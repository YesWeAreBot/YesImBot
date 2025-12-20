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
    }),
}).i18n({
    "zh-CN": require("./locales/zh-CN.yml")._config,
    "en-US": require("./locales/en-US.yml")._config,
});

class OpenAIProvider extends SharedProvider<any, ModelConfig> {
    constructor(name: string, provider: any, config: Config, runtime?: { fetch?: any; proxy?: string }) {
        const processedConfig = { ...config };
        let baseURL = (processedConfig.baseURL || "").trim();

        if (!baseURL || baseURL.replace(/\/+$/, "") === "") {
            throw new Error("无效的 baseURL：值为空或仅包含斜杠。");
        }

        // 移除末尾斜杠
        baseURL = baseURL.replace(/\/+$/, "");

        // 如果不以版本号(如 /v1, /v4)结尾，则补上 /v1
        if (!/\/v\d+$/.test(baseURL)) {
            baseURL += "/v1";
        }

        processedConfig.baseURL = baseURL;

        super(name, provider, processedConfig, runtime);
    }
}

export function apply(ctx: Context, config: Config) {
    const providerName = "openai";
    const provider = new OpenAIProvider("openai", {} as any, config, { proxy: config.proxy });
    ctx.on("ready", async () => {
        const registry = ctx.get("yesimbot.model");
        if (!registry) {
            ctx.logger.warn("ProviderRegistry 未就绪，跳过注册");
            return;
        }

        try {
            registry.setProvider(providerName, provider);
        } catch (err: any) {
            ctx.logger.warn(`注册 provider 失败: ${err?.message ?? String(err)}`);
        }

        try {
            const models = await provider.getOnlineModels();
            ctx.logger.info(`获取到 ${models.length} 个模型信息`);

            registry.addChatModels(
                providerName,
                models
                    .filter((modelId) => modelId.startsWith("gpt-"))
                    .map((modelId) => ({ modelId, modelType: ModelType.Chat })),
            );

            registry.addEmbedModels(providerName, [
                { modelId: "text-embedding-3-small", modelType: ModelType.Embed, dimension: 1536 },
                { modelId: "text-embedding-3-large", modelType: ModelType.Embed, dimension: 3072 },
            ]);
        } catch (err: any) {
            ctx.logger.warn(`注册模型目录失败: ${err?.message ?? String(err)}`);
        }
    });

    ctx.on("dispose", () => {
        const registry = ctx.get("yesimbot.model");
        if (!registry)
            return;

        try {
            registry.removeProvider(providerName);
        } catch (err: any) {
            ctx.logger.warn(`注销 provider 失败: ${err?.message ?? String(err)}`);
        }
    });
}
