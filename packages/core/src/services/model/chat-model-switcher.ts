import { Context, Logger } from "koishi";
import { ModelService } from "./model-service";
import { ChatModel } from "./impl/chat-model";
import { ModelDescriptor } from "./config";
import { Services } from "../types";

export class ChatModelSwitcher {
    private currentIndex = 0;
    private currentModelDescriptors: ModelDescriptor[]; // 实际生效的模型列表
    private logger: Logger;
    private modelService: ModelService;

    constructor(ctx: Context, initialModelDescriptors: ModelDescriptor[]) {
        this.modelService = ctx[Services.Model];
        this.logger = ctx.logger("chat-model-switcher");
        this.currentModelDescriptors = initialModelDescriptors;
        this.logStatus();
    }

    /**
     * 更新模型列表，例如在配置更改后调用。
     * @param newDescriptors 新的模型描述符列表。
     */
    public updateModelPriority(newDescriptors: ModelDescriptor[]): void {
        this.currentModelDescriptors = newDescriptors;
        this.currentIndex = 0; // 重置索引到第一个模型
        this.logStatus();
    }

    public get length(): number {
        return this.currentModelDescriptors.length;
    }

    /**
     * 获取当前激活的 ChatModel 实例。
     * 如果当前模型不可用或未初始化，会尝试切换到下一个模型。
     * @returns 当前可用的 ChatModel 实例。
     * @throws Error 如果所有模型都不可用。
     */
    public getCurrent(): ChatModel {
        if (this.length === 0) {
            throw new Error("ChatModelSwitcher: No models are configured.");
        }

        const MAX_ATTEMPTS = this.length * 2; // 防止无限循环，最多尝试两轮
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            const descriptor = this.currentModelDescriptors[this.currentIndex];
            const model = this.modelService.getChatModel(descriptor.ProviderName, descriptor.ModelId);

            if (model) {
                this.logger.debug(`使用模型: ${descriptor.ProviderName}:${descriptor.ModelId}`);
                return model;
            } else {
                this.logger.warn(`模型获取失败: ${descriptor.ProviderName}:${descriptor.ModelId}。尝试下一个模型。`);
                this.switchToNextInternal(); // 尝试切换到下一个
            }
        }

        throw new Error("ChatModelSwitcher: Failed to find any available chat model after multiple attempts.");
    }

    /**
     * 切换到下一个可用的 ChatModel。
     * @returns 下一个可用的 ChatModel 实例。
     */
    public switchToNext(): ChatModel {
        this.switchToNextInternal();
        return this.getCurrent(); // 返回切换后的模型
    }

    /**
     * 内部方法，进行模型索引的切换。
     */
    private switchToNextInternal(): void {
        if (this.length > 0) {
            this.currentIndex = (this.currentIndex + 1) % this.length;
            this.logger.debug(`切换到下一个模型，当前索引: ${this.currentIndex}`);
            this.logStatus();
        }
    }

    /**
     * 获取当前模型描述符。
     */
    public getCurrentDescriptor(): ModelDescriptor {
        if (this.length === 0) {
            throw new Error("ChatModelSwitcher: No models are configured.");
        }
        return this.currentModelDescriptors[this.currentIndex];
    }

    private logStatus(): void {
        this.logger.info(
            `模型切换器初始化完成。总模型数: ${this.length}. 当前可用模型（按优先级）: [${this.currentModelDescriptors
                .map((d) => `${d.ProviderName}:${d.ModelId}`)
                .join(", ")}]`
        );
    }
}
