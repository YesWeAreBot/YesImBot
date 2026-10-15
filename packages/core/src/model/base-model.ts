import { Context, Logger } from "koishi";

import type { LoggerService } from "../logger";
import { ModelConfig } from "./config";

export function formatModelIdentity(config: Pick<ModelConfig, "providerName" | "modelId">): string {
    return `${config.providerName ? `[${config.providerName}]` : ""}[${config.modelId}]`;
}

/**
 * 所有模型类的基类，封装了通用属性和方法。
 */
export abstract class BaseModel {
    public readonly id: string;
    public readonly config: ModelConfig;
    protected readonly logger: Logger;
    protected readonly ctx: Context;

    constructor(ctx: Context, modelConfig: ModelConfig, loggerName: string, logging: LoggerService) {
        this.ctx = ctx;
        this.config = modelConfig;
        this.id = modelConfig.modelId;
        this.logger = logging.getLogger(loggerName);
    }
}
