/**
 * LLM请求的重试策略配置
 */
export interface RetryConfig {
    MaxRetries: number;
    TimeoutMs: number;
    RetryDelayMs: number;
    ExponentialBackoff: boolean;
    RetryableErrors: string[];
}

/**
 * LLM适配器（Provider）切换配置
 */
export interface AdapterSwitchingConfig {
    Enabled: boolean;
    MaxAttempts: number;
}

/**
 * LLM处理器配置
 */
export interface LLMProcessingConfig {
    Debug?: boolean;
    EnableStreaming?: boolean;
    RetryConfig: RetryConfig;
    AdapterSwitchingConfig: AdapterSwitchingConfig;
}

/**
 * 推理中间件的主配置
 */
export interface ReasoningConfig {
    MaxHeartbeat: number;
    EnableDebug?: boolean;
    // 将LLM处理配置作为子对象，结构更清晰
    Processing: LLMProcessingConfig;
}