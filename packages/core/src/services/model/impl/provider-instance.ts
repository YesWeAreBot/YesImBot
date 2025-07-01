import { Context, Logger } from "koishi";
import { ProxyAgent, fetch as ufetch } from "undici";
import { isNotEmpty } from "../../../shared/utils";
import { Ability, ProviderConfig } from "../config";
import { IProviderClient } from "../factories/base";
import { ChatModel } from "./chat-model";
import { EmbedModel } from "./embed-model";

export class ProviderInstance {
    public readonly name: string;
    private readonly fetch: typeof globalThis.fetch;
    private logger: Logger;

    constructor(private ctx: Context, public readonly config: ProviderConfig, private readonly client: IProviderClient) {
        this.name = config.Name;
        this.logger = ctx.logger("model").extend(this.name);
        this.logger.info(`初始化提供商实例: "${this.name}"`);

        if (isNotEmpty(this.config.Proxy)) {
            // 设置支持代理的 fetch 函数
            this.fetch = (async (input, init) => {
                this.logger.debug(`使用代理 "${this.config.Proxy}"`);
                init = { ...init, dispatcher: new ProxyAgent(this.config.Proxy) };

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
        // 1. 检查 Provider 是否支持 chat 能力
        if (!this.client.chat) {
            this.logger.debug(`提供商 "${this.name}" 不支持聊天能力。`);
            return null;
        }

        // 2. 在该 Provider 的配置中查找模型
        const modelConfig = this.config.Models.find((m) => m.ModelID === modelId);
        if (!modelConfig) {
            this.logger.debug(`未在提供商 "${this.name}" 中找到模型 ID "${modelId}"。`);
            return null;
        }

        // 3. 创建并返回 ChatModel 实例
        this.logger.debug(`成功获取聊天模型 "${modelId}"。`);
        return new ChatModel(this.ctx, this.client.chat, modelConfig, this.fetch);
    }

    /**
     * 获取指定 ID 的嵌入模型实例。
     * @param modelId - ModelConfig.ModelID
     * @returns EmbedModel 实例或 null。
     */
    public getEmbedModel(modelId: string): EmbedModel | null {
        // 1. 检查 Provider 是否支持 embed 能力
        if (!this.client.embed) {
            this.logger.debug(`提供商 "${this.name}" 不支持嵌入能力。`);
            return null;
        }

        // 2. 在该 Provider 的配置中查找模型
        const modelConfig = this.config.Models.find((m) => m.ModelID === modelId);
        if (!modelConfig) {
            this.logger.debug(`未在提供商 "${this.name}" 中找到模型 ID "${modelId}"。`);
            return null;
        }

        // 3. 检查模型是否具有嵌入能力 (Ability.Embedding)
        if (!(modelConfig.Ability & Ability.Embedding)) {
            this.logger.debug(`模型 "${modelId}" 在提供商 "${this.name}" 中未声明 Embedding 能力。`);
            return null;
        }

        // 4. 创建并返回 EmbedModel 实例
        this.logger.debug(`成功获取嵌入模型 "${modelId}"。`);
        return new EmbedModel(this.ctx, this.client.embed, modelConfig, this.fetch);
    }

    // TODO: 添加对其他能力 (image, speech 等) 的 get 方法，如果需要的话
}
