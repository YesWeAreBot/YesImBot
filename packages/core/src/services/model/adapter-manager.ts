import { Context, Logger } from "koishi";

import { LLMAdapterError, LLMRequestError, LLMRetryExhaustedError } from "../../shared/errors";
import { ChatModelSwitcher } from "./chat-model-switcher";
import { ChatModel } from "./impl/chat-model";

// AdapterManager 的配置
export interface AdapterSwitchingConfig {
    enabled: boolean;
    maxAttempts: number; // 最大尝试切换多少个不同的适配器
}

export class LLMAdapterManager {
    private failedAdapterNames: Set<string> = new Set();
    private logger: Logger;

    // 默认适配器切换配置
    private readonly defaultAdapterConfig: AdapterSwitchingConfig = {
        enabled: true,
        maxAttempts: 3, // 默认最多尝试 3 个不同的适配器
    };

    // 合并后的配置
    public readonly config: AdapterSwitchingConfig;

    constructor(ctx: Context, private chatModelSwitcher: ChatModelSwitcher, adapterConfig: Partial<AdapterSwitchingConfig>) {
        this.config = { ...this.defaultAdapterConfig, ...adapterConfig };
        this.logger = ctx.logger("model").extend("adapter-manager");
        this.logger.info(`适配器管理器配置: ${JSON.stringify(this.config)}`);
    }

    /**
     * 执行带适配器切换的 LLM 请求。
     * @param operation - 实际执行 LLM 调用的函数，接收当前适配器名称和模型实例。
     *                    该函数内部应使用 LLMRetryManager 来处理重试。
     * @returns 操作的结果。
     * @throws 如果所有适配器都尝试失败。
     */
    public async executeWithAdapterSwitching<T>(operation: (adapterName: string, model: ChatModel) => Promise<T>): Promise<T> {
        // 如果未启用适配器切换，则直接使用当前模型进行一次操作
        if (!this.config.enabled || this.chatModelSwitcher.length === 0) {
            this.logger.debug("适配器切换禁用或无可用模型，直接使用当前模型。");
            try {
                const currentModel = this.chatModelSwitcher.getCurrent();
                const adapterName = this.getAdapterName(currentModel);
                return await operation(adapterName, currentModel);
            } catch (error) {
                // 捕获切换器本身可能抛出的错误（如模型未找到）
                throw new LLMAdapterError(error.message || "无可用适配器", "unknown", 0, error);
            }
        }

        const totalAdapters = this.chatModelSwitcher.length;
        let attempts = 0;
        let lastError: Error | null = null;

        // 每次新请求时重置失败适配器列表
        this.failedAdapterNames.clear();

        // 循环尝试适配器，直到达到最大尝试次数或尝试完所有适配器
        while (attempts < this.config.maxAttempts && this.failedAdapterNames.size < totalAdapters) {
            let currentModel: ChatModel | null = null;
            let currentAdapterName = "unknown";

            // 找到一个未失败过的模型
            for (let i = 0; i < totalAdapters; i++) {
                const model = this.chatModelSwitcher.getCurrent();
                const adapterName = this.getAdapterName(model);

                if (!this.failedAdapterNames.has(adapterName)) {
                    currentModel = model;
                    currentAdapterName = adapterName;
                    break; // 找到一个可用的，跳出内层循环
                }
                // 如果当前模型已失败，则尝试切换到下一个
                this.logger.debug(`适配器 "${adapterName}" 已标记为失败，尝试切换。`);
                this.chatModelSwitcher.switchToNext();
            }

            // 如果在尝试完所有模型后仍未找到可用模型 (理论上不应发生，除非Switcher逻辑有问题)
            if (!currentModel) {
                // 这种情况可能发生在：所有模型都标记为失败，但循环未结束
                // 或者模型列表为空
                const descriptor = this.chatModelSwitcher.getCurrentDescriptor(); // 获取当前尝试的模型描述
                currentAdapterName = `${descriptor.ProviderName}:${descriptor.ModelId}`;
                this.logger.error(`在尝试切换后仍未找到可用模型。当前尝试的潜在模型: ${currentAdapterName}`);
                throw new LLMAdapterError(`所有 LLM 适配器都已失败或不可用`, currentAdapterName, this.failedAdapterNames.size, lastError);
            }

            this.logger.debug(`使用适配器 "${currentAdapterName}" (尝试 ${attempts + 1}/${this.config.maxAttempts})`);

            try {
                // 执行操作，这里 operation 内部会调用 retryManager
                const result = await operation(currentAdapterName, currentModel);

                if (attempts > 0) {
                    this.logger.info(`适配器切换成功，已切换到 "${currentAdapterName}"。`);
                }
                // 成功后，如果之前切换过，可以重置状态（虽然这里不直接处理，是独立的职责）
                return result;
            } catch (error: any) {
                lastError = error;
                this.failedAdapterNames.add(currentAdapterName); // 标记当前适配器失败
                this.logger.warn(`适配器 "${currentAdapterName}" 失败: ${error.message || error}`);

                // 如果是不可重试的错误，直接抛出
                if (error instanceof LLMRequestError && !error.isRetryable) {
                    this.logger.error(`适配器 "${currentAdapterName}" 遭遇永久性错误，终止尝试。`);
                    throw error;
                }

                // 切换到下一个适配器（如果还有机会）
                if (this.failedAdapterNames.size < totalAdapters && attempts < this.config.maxAttempts - 1) {
                    this.logger.info(`切换到下一个适配器，剩余尝试次数: ${this.config.maxAttempts - attempts - 1}`);
                    this.chatModelSwitcher.switchToNext();
                } else {
                    this.logger.debug("已尝试所有适配器或达到最大尝试次数。");
                }
                attempts++; // 增加尝试总数
            }
        }

        // 所有适配器都尝试失败
        throw new LLMRetryExhaustedError(
            `所有 LLM 适配器都已失败或不可用`,
            this.failedAdapterNames.size,
            Array.from(this.failedAdapterNames),
            lastError
        );
    }

    /**
     * 获取适配器（模型）的名称，用于日志记录。
     */
    private getAdapterName(model: ChatModel): string {
        // 从 ChatModel 的内部标识符中提取或构建名称
        // 例如：model.id 可能是 "providerName:modelId" 或者直接是 model.constructor.name
        // 假设 model.id 已经包含了足够的信息，或者我们可以从 modelService 获取模型描述符
        try {
            const descriptor = this.chatModelSwitcher.getCurrentDescriptor(); // 获取当前模型描述符
            return `${descriptor.ProviderName}:${descriptor.ModelId}`;
        } catch (e) {
            return "unknown-model";
        }
    }
}
