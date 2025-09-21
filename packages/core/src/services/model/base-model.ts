import { Context, Logger } from "koishi";
import { ModelConfig } from "./config";

export abstract class BaseModel {
    public readonly id: string;
    public readonly config: ModelConfig;
    protected readonly logger: Logger;
    protected readonly ctx: Context;

    constructor(ctx: Context, modelConfig: ModelConfig) {
        this.ctx = ctx;
        this.config = modelConfig;
        this.id = modelConfig.modelId;
    }
}
