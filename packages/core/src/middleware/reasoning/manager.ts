import { ChatModel, ModelService } from "../../services";
import { LLMRetryExhaustedError } from "../../shared";
import { LLMProcessingConfig } from "./config";

/**
 * LLM重试管理器
 */
export class RetryManager {
    constructor(private config: LLMProcessingConfig["RetryConfig"], private logger: any) {}

    async executeWithRetry<T>(
        operation: (abortSignal: AbortSignal, cancelTimeout: () => void) => Promise<T>,
        adapterName: string
    ): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.config.MaxRetries; attempt++) {
            try {
                // 创建超时控制器
                const controller = new AbortController();
                const timeoutId = setTimeout(() => {
                    controller.abort();
                }, this.config.TimeoutMs);

                const cancelTimeout = () => clearTimeout(timeoutId);

                const result = await operation(controller.signal, cancelTimeout);
                clearTimeout(timeoutId);

                if (attempt > 0) {
                    this.logger.info(`重试成功 (适配器: ${adapterName}, 尝试: ${attempt + 1})`);
                }

                return result;
            } catch (error) {
                lastError = error as Error;

                // 检查是否为可重试错误
                if (!this.isRetryableError(error as Error)) {
                    throw error;
                }

                // 最后一次尝试失败
                if (attempt === this.config.MaxRetries) {
                    break;
                }

                // 计算延迟时间
                const delay = this.calculateDelay(attempt);
                this.logger.warn(
                    `LLM请求失败，${delay}ms后重试 (适配器: ${adapterName}, ` +
                        `尝试: ${attempt + 1}/${this.config.MaxRetries + 1}, 错误: ${error.message})`
                );

                await this.sleep(delay);
            }
        }

        throw new LLMRetryExhaustedError(`LLM请求重试耗尽 (适配器: ${adapterName})`, this.config.MaxRetries, null, lastError);
    }

    private isRetryableError(error: Error): boolean {
        return this.config.RetryableErrors.some((pattern) => error.name.includes(pattern) || error.message.includes(pattern));
    }

    private calculateDelay(attempt: number): number {
        if (this.config.ExponentialBackoff) {
            return this.config.RetryDelayMs * Math.pow(2, attempt);
        }
        return this.config.RetryDelayMs;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

/**
 * LLM适配器管理器
 */
export class AdapterManager {
    constructor(private modelService: ModelService, private config: LLMProcessingConfig["AdapterSwitchingConfig"], private logger: any) {}

    async executeWithAdapterSwitching<T>(operation: (adapterName: string, model: ChatModel) => Promise<T>): Promise<T> {
        if (!this.config.Enabled) {
            // 未启用适配器切换，则使用当前模型
            const switcher = this.modelService.getChatModelSwitcher([]);
            const model = switcher.getCurrent();
            const descriptor = switcher.getCurrentDescriptor();
            return await operation(descriptor.ProviderName, model);
        }

        // 获取所有可用的Provider名称
        const providerNames = this.modelService.getProviderNames();

        let lastError: Error | null = null;

        for (let attempt = 0; attempt < Math.min(this.config.MaxAttempts, providerNames.length); attempt++) {
            try {
                const providerName = providerNames[attempt];
                // 获取该Provider实例
                const provider = this.modelService.getProviderInstances().get(providerName);
                if (!provider) {
                    throw new Error(`Provider ${providerName} not found`);
                }

                // 使用该Provider的第一个可用模型
                const model = provider.getFirstAvailableChatModel();
                if (!model) {
                    throw new Error(`No available chat models found in provider ${providerName}`);
                }

                this.logger.debug(`尝试适配器: ${providerName} (尝试: ${attempt + 1})`);
                const result = await operation(providerName, model);

                if (attempt > 0) {
                    this.logger.info(`适配器切换成功: ${providerName}`);
                }

                return result;
            } catch (error) {
                lastError = error as Error;
                this.logger.warn(`适配器 ${providerNames[attempt]} 失败: ${error.message}`);

                // 如果是最后一次尝试，抛出错误
                if (attempt === this.config.MaxAttempts - 1 || attempt === providerNames.length - 1) {
                    break;
                }
            }
        }

        throw lastError || new Error("所有适配器都失败了");
    }
}
