import { Context, Logger } from "koishi";
import { ProxyAgent, fetch as ufetch } from "undici";
import { isNotEmpty } from "../../shared/utils";
import { Services } from "../types";
import { ChatModel } from "./chat-model";
import { ModelAbility, ProviderConfig } from "./config";
import { EmbedModel } from "./embed-model";
import { IProviderClient } from "./factories";

export class ProviderInstance {
    public readonly name: string;
    private readonly fetch: typeof globalThis.fetch;
    private logger: Logger;

    constructor(private ctx: Context, public readonly config: ProviderConfig, private readonly client: IProviderClient) {
        this.name = config.name;

        this.logger = ctx[Services.Logger].getLogger(`[提供商] [${this.name}]`);
        this.logger.info(`[初始化] 🔌 提供商实例已创建`);

        if (isNotEmpty(this.config.proxy)) {
            this.fetch = (async (input, init) => {
                this.logger.debug(`[网络] 🌐 使用代理 | 地址: ${this.config.proxy}`);
                init = { ...init, dispatcher: new ProxyAgent(this.config.proxy) };
                return await ufetch(input, init);
            }) as unknown as typeof globalThis.fetch;
        }
    }

    /**
     * 获取指定 ID 的聊天模型实例。
     * @param modelId - ModelConfig.ModelID
     * @returns ChatModel 实例或 null。
     */
    public getChatModel(modelId: string): ChatModel | null {
        if (!this.client.chat) {
            this.logger.debug(`[获取模型] 💬 跳过 | 原因: 不支持聊天能力`);
            return null;
        }

        const modelConfig = this.config.models.find((m) => m.modelId === modelId);
        if (!modelConfig) {
            this.logger.debug(`[获取模型] 💬 未找到 | 模型ID: ${modelId}`);
            return null;
        }

        this.logger.debug(`[获取模型] 💬 成功 | 模型ID: ${modelId}`);
        return new ChatModel(this.ctx, this.client.chat, modelConfig, this.fetch);
    }

    /**
     * 获取指定 ID 的嵌入模型实例。
     * @param modelId - ModelConfig.ModelID
     * @returns EmbedModel 实例或 null。
     */
    public getEmbedModel(modelId: string): EmbedModel | null {
        if (!this.client.embed) {
            this.logger.debug(`[获取模型] 🔗 跳过 | 原因: 不支持嵌入能力`);
            return null;
        }

        const modelConfig = this.config.models.find((m) => m.modelId === modelId);
        if (!modelConfig) {
            this.logger.debug(`[获取模型] 🔗 未找到 | 模型ID: ${modelId}`);
            return null;
        }

        if (!modelConfig.abilities.includes(ModelAbility.Embedding)) {
            this.logger.debug(`[获取模型] 🔗 跳过 | 模型 ${modelId} 未声明嵌入能力`);
            return null;
        }

        this.logger.debug(`[获取模型] 🔗 成功 | 模型ID: ${modelId}`);
        return new EmbedModel(this.ctx, this.client.embed, modelConfig, this.fetch);
    }
}