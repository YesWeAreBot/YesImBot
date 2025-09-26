import { Logger } from "koishi";
import { ModelConfig } from "./config";

export abstract class BaseModel {
    public readonly id: string;
    public readonly config: ModelConfig;
    protected readonly logger: Logger;

    constructor(logger: Logger, modelConfig: ModelConfig) {
        this.config = modelConfig;
        this.id = modelConfig.modelId;
        this.logger = logger;
    }
}
