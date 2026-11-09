import { Context, Logger } from "koishi";
import { ProxyAgent, fetch as ufetch } from "undici";

import type { LoggerService } from "../logger";
import { isNotEmpty } from "../shared/utils";
import { BaseModel } from "./base-model";
import { ChatModel, IChatModel } from "./chat-model";
import { ModelAbility, ModelConfig, ProviderConfig } from "./config";
import { ContextLimitResult, contextMetadataURL, parseContextLimit, readContextLimitMetadata } from "./context-limit";
import { EmbedModel, IEmbedModel } from "./embed-model";
import { EvaluationModel } from "./evaluation-model";
import { IProviderClient } from "./factories";
import { createNativeFetch } from "./native-fetch";
import type { UsageOwner } from "./usage-owner";

export class ProviderInstance {
    public readonly name: string;
    private readonly fetch: typeof globalThis.fetch;
    private logger: Logger;
    private contextMetadataCache?: {
        expiresAt: number;
        result: Promise<{ checkedAt: number; payload?: unknown; reason?: string }>;
    };
    private readonly discoveredContextLimits = new Map<string, ContextLimitResult>();

    constructor(
        private ctx: Context,
        public readonly config: ProviderConfig,
        private readonly client: IProviderClient,
        private readonly logging: LoggerService,
        private readonly usageOwner?: UsageOwner,
    ) {
        this.name = config.name;
        this.logger = logging.getLogger(`[提供商] [${this.name}]`);

        if (isNotEmpty(this.config.proxy)) {
            this.fetch = (async (input: any, init: any) => {
                this.logger.debug(`🌐 使用代理 | 地址: ${this.config.proxy}`);
                init = { ...init, dispatcher: new ProxyAgent(this.config.proxy!) };
                return ufetch(input as any, init as any);
            }) as unknown as typeof globalThis.fetch;
        } else {
            this.fetch = ufetch as unknown as typeof globalThis.fetch;
        }

        this.fetch = createNativeFetch(config, this.fetch);

        // this.logger.info(`[初始化] 🔌 提供商实例已创建`);
    }

    /**
     * (优化) 通用模型获取器
     */
    private _getModel<T extends BaseModel>(
        modelId: string,
        requiredAbility: ModelAbility,
        modelConstructor: new (
            ctx: Context,
            providerFn: any,
            config: ModelConfig,
            fetch: typeof globalThis.fetch,
            logging: LoggerService,
            usageOwner?: UsageOwner,
        ) => T,
        providerCapability: unknown,
        capabilityName: string,
    ): T | null {
        if (!providerCapability) {
            this.logger.debug(`[获取模型] 🟡 跳过 | 模型ID: ${modelId} | 原因: 提供商不支持 ${capabilityName} 能力`);
            return null;
        }

        const modelConfig = this.config.models.find((m) => m.modelId === modelId);
        if (!modelConfig) {
            this.logger.warn(`[获取模型] 🟡 未找到 | 模型ID: ${modelId}`);
            return null;
        }

        if (!modelConfig.abilities.includes(requiredAbility)) {
            this.logger.warn(`[获取模型] 🟡 跳过 | 模型 ${modelId} 未声明 '${requiredAbility}' 能力`);
            return null;
        }

        const finalModelConfig: ModelConfig = {
            ...modelConfig,
            providerName: this.name,
            // Native LM Studio chat cannot carry client-owned tools; retain the framework's JSON-action fallback.
            ...(this.config.type === "LM Studio" ? { disableNativeToolCalling: true } : {}),
        };

        //this.logger.debug(`[获取模型] 🟢 成功 | 模型ID: ${modelId} | 能力: ${capabilityName}`);
        return new modelConstructor(this.ctx, providerCapability, finalModelConfig, this.fetch, this.logging, this.usageOwner);
    }

    public getEvaluationModel(modelId: string): EvaluationModel | null {
        return this._getModel(modelId, ModelAbility.Evaluation, EvaluationModel, this.client.evaluate, "评估");
    }

    public getChatModel(modelId: string): IChatModel | null {
        return this._getModel(modelId, ModelAbility.Chat, ChatModel, this.client.chat, "对话");
    }

    public getEmbedModel(modelId: string): IEmbedModel | null {
        return this._getModel(modelId, ModelAbility.Embedding, EmbedModel, this.client.embed, "嵌入");
    }

    /** Read-only metadata discovery, never invoked for unset or manual capacities. */
    public async getContextLimit(modelId: string): Promise<ContextLimitResult> {
        const declaration = this.config.models.find((model) => model.modelId === modelId)?.contextLimit;
        if (!declaration || declaration.mode !== "auto") return this.peekContextLimit(modelId);
        const result = await this.discoverContextLimit(modelId);
        this.discoveredContextLimits.set(modelId, result);
        return result;
    }

    /** Return declaration/last discovery only; history inspection must never fetch. */
    public peekContextLimit(modelId: string): ContextLimitResult {
        const declaration = this.config.models.find((model) => model.modelId === modelId)?.contextLimit;
        if (!declaration || declaration.mode === "unset") return { mode: "unset", status: "unset" };
        if (declaration.mode === "custom") {
            try {
                return { mode: "custom", status: "known", tokens: parseContextLimit(declaration.value ?? ""), source: "manual" };
            } catch {
                return { mode: "custom", status: "unknown", reason: "自定义容量无效" };
            }
        }
        return this.discoveredContextLimits.get(modelId) ?? { mode: "auto", status: "unknown", reason: "尚未获取模型元数据" };
    }

    private async discoverContextLimit(modelId: string): Promise<ContextLimitResult> {
        const now = Date.now();
        if (!this.contextMetadataCache || this.contextMetadataCache.expiresAt <= now) {
            this.contextMetadataCache = { expiresAt: now + 5 * 60_000, result: this.fetchContextMetadata() };
        }
        const { checkedAt, payload, reason } = await this.contextMetadataCache.result;
        if (reason) return { mode: "auto", status: "unknown", checkedAt, reason };
        const metadata = readContextLimitMetadata(payload, modelId);
        if (!metadata) return { mode: "auto", status: "unknown", checkedAt, reason: "API 未返回该模型的明确上下文容量" };
        return { mode: "auto", status: "known", tokens: metadata.tokens, source: `API /models: ${metadata.field}`, checkedAt };
    }

    private async fetchContextMetadata(): Promise<{ checkedAt: number; payload?: unknown; reason?: string }> {
        const checkedAt = Date.now();
        const unknown = (reason: string) => ({ checkedAt, reason });
        try {
            if (!this.client.model) return unknown("提供商未提供模型元数据入口");
            const options = this.client.model();
            const url = contextMetadataURL(options.baseURL);
            const headers = new Headers(options.headers);
            if (this.config.type === "Anthropic") {
                if (options.apiKey) headers.set("x-api-key", options.apiKey);
                if (!headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
            } else if (options.apiKey && !headers.has("Authorization")) {
                headers.set("Authorization", `Bearer ${options.apiKey}`);
            }
            const response = await this.fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(10_000), redirect: "error" });
            if (!response.ok) return unknown(`模型元数据请求失败（HTTP ${response.status}）`);
            return { checkedAt, payload: await response.json() };
        } catch {
            // Do not expose transport messages that may contain API keys or proxy credentials.
            return unknown("模型元数据获取失败或超时");
        }
    }
}
