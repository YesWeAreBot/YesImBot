import { ArousalConfig, WillingnessConfig } from "@/agent";
import {
    AssetServiceConfig,
    HistoryConfig,
    LoggingConfig,
    MemoryConfig,
    ModelServiceConfig,
    PromptServiceConfig,
    ToolServiceConfig,
} from "@/services";
import { ErrorReporterConfig } from "@/shared";

export interface ConfigV1 {
    modelService: ModelServiceConfig;
    agentBehavior: {
        arousal: ArousalConfig;
        willingness: WillingnessConfig;
        streamAction: boolean;
        heartbeat: number;
        prompt: {
            systemTemplate: string;
            userTemplate: string;
            multiModalSystemTemplate: string;
        };
        vision: {
            enabled: boolean;
            allowedImageTypes: string[];
            maxImagesInContext: number;
            imageLifecycleCount: number;
            detail: "low" | "high" | "auto";
        };
        newMessageStrategy: "skip" | "immediate" | "deferred";
        deferredProcessingTime?: number;
    };
    capabilities: {
        memory: MemoryConfig;
        history: HistoryConfig;
        tools: ToolServiceConfig;
    };
    assetService: AssetServiceConfig;
    promptService: PromptServiceConfig;
    system: {
        logging: LoggingConfig;
        errorReporting: ErrorReporterConfig;
    };
}
