import { Logger } from "koishi";
import { GenerateTextResult, UserMessagePart } from "xsai";
import { ChatModel, ModelService } from "../../services";
import { LLMProcessingConfig } from "./config";
import { AdapterManager, RetryManager } from "./manager";

export class LLMProcessor {
    private readonly retryManager: RetryManager;
    private readonly adapterManager: AdapterManager;

    constructor(
        private readonly modelService: ModelService,
        private readonly config: LLMProcessingConfig,
        private readonly logger: Logger
    ) {
        this.retryManager = new RetryManager(this.config.RetryConfig, this.logger);
        this.adapterManager = new AdapterManager(this.modelService, this.config.AdapterSwitchingConfig, this.logger);
    }

    /**
     * 执行一个完整的LLM请求，包括适配器切换和重试
     * @param prompts 包含 system 和 user 提示的对象
     * @returns LLM的生成结果
     */
    public async generateResponse(prompts: { system: string; user: string | UserMessagePart[] }): Promise<GenerateTextResult> {
        return this.adapterManager.executeWithAdapterSwitching(async (adapterName, model) => {
            return this.retryManager.executeWithRetry(
                (abortSignal, cancelTimeout) => this.callModel(model, prompts, abortSignal, cancelTimeout),
                adapterName
            );
        });
    }

    /**
     * 调用单个模型进行聊天
     */
    private async callModel(
        model: ChatModel,
        prompts: { system: string; user: string | UserMessagePart[] },
        abortSignal: AbortSignal,
        cancelTimeout: () => void
    ): Promise<GenerateTextResult> {
        return model.chat(
            [
                { role: "system", content: prompts.system },
                { role: "user", content: prompts.user },
            ],
            {
                debug: this.config.Debug,
                logger: this.logger,
                abortSignal,
                onStreamStart: cancelTimeout, // 在流开始时取消超时计时器
            }
        );
    }
}

