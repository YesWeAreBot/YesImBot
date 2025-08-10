import { Services } from "@/shared/constants";
import { isNotEmpty } from "@/shared/utils";
import { Context, Logger } from "koishi";
import { ProxyAgent, fetch as ufetch } from "undici";
import { BaseModel } from "./base-model";
import { ChatModel, IChatModel } from "./chat-model";
import { ModelAbility, ModelConfig, ProviderConfig } from "./config";
import { EmbedModel, IEmbedModel } from "./embed-model";
import { IProviderClient } from "./factories";

export class ProviderInstance {
    public readonly name: string;
    private readonly fetch: typeof globalThis.fetch;
    private logger: Logger;

    constructor(
        private ctx: Context,
        public readonly config: ProviderConfig,
        private readonly client: IProviderClient
    ) {
        this.name = config.name;
        this.logger = ctx[Services.Logger].getLogger(`[提供商] [${this.name}]`);

        if (isNotEmpty(this.config.proxy)) {
            this.fetch = (async (input, init) => {
                this.logger.debug(`[网络] 🌐 使用代理 | 地址: ${this.config.proxy}`);
                init = { ...init, dispatcher: new ProxyAgent(this.config.proxy) };
                return ufetch(input, init);
            }) as unknown as typeof globalThis.fetch;
        } else {
            this.fetch = ufetch as unknown as typeof globalThis.fetch;
        }

        // this.logger.info(`[初始化] 🔌 提供商实例已创建`);
    }

    /**
     * (优化) 通用模型获取器
     */
    private _getModel<T extends BaseModel>(
        modelId: string,
        requiredAbility: ModelAbility,
        modelConstructor: new (ctx: Context, providerFn: any, config: ModelConfig, fetch: typeof globalThis.fetch) => T,
        providerCapability: unknown,
        capabilityName: string
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

        const finalModelConfig: ModelConfig = { ...modelConfig, providerName: this.name };

        //this.logger.debug(`[获取模型] 🟢 成功 | 模型ID: ${modelId} | 能力: ${capabilityName}`);
        return new modelConstructor(this.ctx, providerCapability, finalModelConfig, this.fetch);
    }

    public getChatModel(modelId: string): IChatModel | null {
        return this._getModel(modelId, ModelAbility.Chat, ChatModel, this.client.chat, "对话");
    }

    public getEmbedModel(modelId: string): IEmbedModel | null {
        return this._getModel(modelId, ModelAbility.Embedding, EmbedModel, this.client.embed, "嵌入");
    }
}
