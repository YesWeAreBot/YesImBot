import { Services } from "@/shared/constants";
import { Context, Logger } from "koishi";
import { ModelConfig } from "./config";

/**
 * 所有模型类的基类，封装了通用属性和方法。
 */
export abstract class BaseModel {
    public readonly id: string;
    public readonly config: ModelConfig;
    protected readonly logger: Logger;
    protected readonly ctx: Context;

    constructor(ctx: Context, modelConfig: ModelConfig, loggerName: string) {
        this.ctx = ctx;
        this.config = modelConfig;
        this.id = modelConfig.modelId;
        this.logger = ctx.logger(loggerName);
    }
}
