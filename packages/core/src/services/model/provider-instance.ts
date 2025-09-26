import { Context, Logger } from "koishi";
import { ProxyAgent, fetch as ufetch } from "undici";

import { Services } from "@/shared/constants";
import { isNotEmpty } from "@/shared/utils";
import { ChatModel, IChatModel } from "./chat-model";
import { ChatModelConfig, ModelConfig, ProviderConfig } from "./config";
import { EmbedModel, IEmbedModel } from "./embed-model";
import { IProviderClient } from "./factories";
import { ModelType } from "./types";

export class ProviderInstance {
    public readonly name: string;
    private readonly fetch: typeof globalThis.fetch;

    constructor(
        private ctx: Context,
        public readonly config: ProviderConfig,
        private readonly client: IProviderClient
    ) {
        this.name = config.name;

        if (isNotEmpty(this.config.proxy)) {
            this.fetch = (async (input, init) => {
                this.ctx.logger.debug(`🌐 使用代理 | 地址: ${this.config.proxy}`);
                init = { ...init, dispatcher: new ProxyAgent(this.config.proxy) };
                return ufetch(input, init);
            }) as unknown as typeof globalThis.fetch;
        } else {
            this.fetch = ufetch as unknown as typeof globalThis.fetch;
        }
    }

    public getChatModel(modelId: string): IChatModel | null {
        const modelConfig = this.config.models.find((m) => m.modelId === modelId);
        if (!modelConfig) {
            this.ctx.logger.warn(`模型 ${modelId} 不存在于提供商 ${this.name} 的配置中`);
            return null;
        }
        if (modelConfig.modelType !== ModelType.Chat) {
            this.ctx.logger.warn(`模型 ${modelId} 不是聊天模型`);
            return null;
        }
        return new ChatModel(this.ctx, this.name, this.client.chat, modelConfig as ChatModelConfig, this.fetch);
    }

    public getEmbedModel(modelId: string): IEmbedModel | null {
        const modelConfig = this.config.models.find((m) => m.modelId === modelId);
        if (!modelConfig) {
            this.ctx.logger.warn(`模型 ${modelId} 不存在于提供商 ${this.name} 的配置中`);
            return null;
        }
        if (modelConfig.modelType !== ModelType.Embedding) {
            this.ctx.logger.warn(`模型 ${modelId} 不是嵌入模型`);
            return null;
        }
        return new EmbedModel(this.ctx, this.name, this.client.embed, modelConfig as ModelConfig, this.fetch);
    }
}
