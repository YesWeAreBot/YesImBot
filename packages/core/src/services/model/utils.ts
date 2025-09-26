import { GenerateTextResult } from "@xsai/generate-text";

import { ChatRequestOptions, IChatModel } from "./chat-model";
import { ChatModelSwitcher } from "./model-switcher";
import { ChatModelType, ModelError, ModelErrorType } from "./types";

/**
 * 模型切换器工具类
 * 提供便捷的静态方法和示例代码
 */
export class ModelSwitcherUtils {
    /**
     * 外部控制模式的聊天方法
     * 适用于需要动态更新参数或获取外部状态的场景
     */
    static async chatWithExternalControl(
        switcher: ChatModelSwitcher,
        options: ChatRequestOptions,
        onRetry?: (attempt: number, model: IChatModel, error?: ModelError) => ChatRequestOptions
    ): Promise<GenerateTextResult> {
        // 检测是否包含图片
        const hasImages = options.messages.some((m) => Array.isArray(m.content) && m.content.some((p: any) => p.type === "image_url"));

        let modelType = hasImages ? ChatModelType.Vision : ChatModelType.NonVision;
        let attempt = 0;
        const maxAttempts = 10; // 最大重试次数

        while (attempt < maxAttempts) {
            // 获取一个可用模型
            const model = switcher.pickModel(modelType);

            if (!model) {
                if (modelType === ChatModelType.Vision && hasImages) {
                    // 视觉模型全部失败，降级到普通模型
                    console.log("所有视觉模型均不可用，请移除图片内容后重试");
                    modelType = ChatModelType.NonVision;
                    // 这里可以调用外部回调来更新消息内容
                    if (onRetry) {
                        options = onRetry(attempt, model!, new ModelError(ModelErrorType.UnknownError, "视觉模型不可用", undefined, true));
                    }
                    continue;
                } else {
                    // 所有模型都失败了
                    throw new ModelError(ModelErrorType.UnknownError, "所有模型均不可用", undefined, false);
                }
            }

            try {
                const startTime = Date.now();

                // 如果有回调函数，允许更新请求选项
                const currentOptions = onRetry ? onRetry(attempt, model) : options;

                // 直接调用模型
                const result = await model.chat(currentOptions);

                // 记录成功结果
                const latency = Date.now() - startTime;
                switcher.recordResult(model, true, undefined, latency);

                return result;
            } catch (error) {
                // 记录失败结果
                const startTime = Date.now();
                const modelError = error instanceof ModelError ? error : ModelError.classify(error as Error);
                const latency = Date.now() - startTime;

                switcher.recordResult(model, false, modelError, latency);

                // 如果是不可重试的错误，直接抛出
                if (!modelError.canRetry()) {
                    throw modelError;
                }

                console.warn(`模型 ${model.id} 调用失败: ${modelError.message}, 尝试下一个模型`);
                attempt++;
            }
        }

        throw new ModelError(ModelErrorType.UnknownError, "所有重试都失败了", undefined, false);
    }

    /**
     * 错误分类助手
     * @param error 原始错误
     * @returns 分类后的模型错误
     */
    static classifyError(error: Error): ModelError {
        return ModelError.classify(error);
    }

    /**
     * 检查错误是否可重试
     * @param error 错误对象
     * @returns 是否可重试
     */
    static isRetryableError(error: Error): boolean {
        if (error instanceof ModelError) {
            return error.canRetry();
        }
        return ModelError.classify(error).canRetry();
    }

    /**
     * 创建带有自定义重试逻辑的聊天函数
     * @param switcher 切换器实例
     * @param customRetryLogic 自定义重试逻辑
     * @returns 聊天函数
     */
    static createCustomChatFunction(
        switcher: ChatModelSwitcher,
        customRetryLogic?: (
            attempt: number,
            model: IChatModel | null,
            error: ModelError | null,
            hasImages: boolean
        ) => { shouldRetry: boolean; newOptions?: ChatRequestOptions; newModelType?: ChatModelType }
    ) {
        return async (options: ChatRequestOptions): Promise<GenerateTextResult> => {
            if (customRetryLogic) {
                return ModelSwitcherUtils.chatWithExternalControl(switcher, options, (attempt, model, error) => {
                    const hasImages = options.messages.some(
                        (m) => Array.isArray(m.content) && m.content.some((p: any) => p.type === "image_url")
                    );

                    const result = customRetryLogic(attempt, model, error || null, hasImages);
                    return result.newOptions || options;
                });
            } else {
                // 使用内建的自动重试
                return switcher.chat(options);
            }
        };
    }

    /**
     * 批量测试模型健康状态
     * @param switcher 切换器实例
     * @param testMessage 测试消息
     * @returns 测试结果
     */
    static async batchHealthCheck(
        switcher: ChatModelSwitcher,
        testMessage: string = "Hello, this is a health check."
    ): Promise<Array<{ modelId: string; success: boolean; latency?: number; error?: string }>> {
        const results: Array<{ modelId: string; success: boolean; latency?: number; error?: string }> = [];
        const allModels = switcher.getModels();

        for (const model of allModels) {
            const startTime = Date.now();
            try {
                await model.chat({
                    messages: [{ role: "user", content: testMessage }],
                    stream: false,
                    temperature: 0.1,
                });

                const latency = Date.now() - startTime;
                results.push({ modelId: model.id, success: true, latency });
                switcher.recordResult(model, true, undefined, latency);
            } catch (error) {
                const latency = Date.now() - startTime;
                const modelError = ModelError.classify(error as Error);
                results.push({
                    modelId: model.id,
                    success: false,
                    latency,
                    error: modelError.message,
                });
                switcher.recordResult(model, false, modelError, latency);
            }
        }

        return results;
    }
}
