/* eslint-disable ts/no-require-imports */
/* eslint-disable ts/no-redeclare */
import type { SharedConfig } from "@yesimbot/shared-model";
import type { Context } from "koishi";
import { openai } from "@yesimbot/shared-model";
import { Schema } from "koishi";

export interface Config extends SharedConfig {
    baseURL: string;
    apiKey: string;
}

export const name = "provider-openai";
export const usage = "";
export const inject = [];
export const Config: Schema<Config> = Schema.object({
    baseURL: Schema.string().default("https://api.openai.com/v1/"),
    apiKey: Schema.string().required(),
    proxy: Schema.string().default(""),
    retry: Schema.number().default(3),
    retryDelay: Schema.number().default(1000),
    modelConfig: Schema.object({
        temperature: Schema.number().min(0).max(2).step(0.01).role("slider").default(1),
        topP: Schema.number().min(0).max(1).step(0.01).role("slider").default(1),
        frequencyPenalty: Schema.number().min(-2).max(2).step(0.01).role("slider").default(0),
        presencePenalty: Schema.number().min(-2).max(2).step(0.01).role("slider").default(0),
        headers: Schema.dict(String).default({}),
        reasoning_effort: Schema.union(["none", "minimal", "low", "medium", "high", "xhigh"]).default("medium"),
        max_completion_tokens: Schema.number(),
    }),
}).i18n({
    "zh-CN": require("./locales/zh-CN.yml")._config,
    "en-US": require("./locales/en-US.yml")._config,
});

export async function apply(ctx: Context, config: Config) {}

interface Provider<P> {
    instance: P;
}

const obj: Provider<typeof openai> = {
    instance: openai,
};
