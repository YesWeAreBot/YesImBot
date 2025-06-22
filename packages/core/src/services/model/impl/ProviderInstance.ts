import { ProxyAgent, fetch as ufetch } from "undici";

import { isNotEmpty } from "../../../shared/utils";
import { IProviderClient } from "../factories/base";
import { Ability, ProviderConfig } from "../types";
import { ChatModel } from "./ChatModel";
import { EmbedModel } from "./EmbedModel";

export class ProviderInstance {
    public readonly name: string;
    private readonly fetch: typeof globalThis.fetch;

    constructor(
        public readonly config: ProviderConfig,
        private readonly client: IProviderClient // 依赖注入！
    ) {
        this.name = config.Name;
        this.fetch = (async (input, init) => {
            const proxy = this.config.Proxy;
            if (isNotEmpty(proxy)) {
                init = { ...init, dispatcher: new ProxyAgent(proxy) };
            }
            return await ufetch(input, init);
        }) as unknown as typeof globalThis.fetch;
    }

    public getChatModel(modelId: string): ChatModel | null {
        // 1. 检查 Provider 是否支持 chat
        if (!this.client.chat) {
            return null;
        }

        // 2. 查找模型配置
        const modelConfig = this.config.Models.find((m) => m.ModelID === modelId);
        if (!modelConfig) {
            return null;
        }

        // 3. 创建 ChatModel 实例
        return new ChatModel(this.client.chat, modelConfig, this.fetch);
    }

    public getEmbedModel(modelId: string): EmbedModel | null {
        // 1. 检查 Provider 是否支持 embed
        if (!this.client.embed) {
            return null;
        }

        // 2. 查找模型配置
        const modelConfig = this.config.Models.find((m) => m.ModelID === modelId);

        // 3. 检查模型是否有 Embedding 能力
        if (!modelConfig || !(modelConfig.Ability & Ability.Embedding)) {
            return null;
        }

        // 4. 创建 EmbedModel 实例
        return new EmbedModel(this.client.embed, modelConfig, this.fetch);
    }

    /**
     * 获取第一个可用的聊天模型
     */
    public getFirstAvailableChatModel(): ChatModel | null {
        if (!this.client.chat || this.config.Models.length === 0) {
            return null;
        }

        // 返回第一个有效的模型
        for (const modelConfig of this.config.Models) {
            const model = this.getChatModel(modelConfig.ModelID);
            if (model) {
                return model;
            }
        }
        return null;
    }
}
