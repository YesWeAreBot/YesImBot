import { Eval, Session } from "koishi";

type ChannelDescriptor = {
    platform: string;
    type: "private" | "guild";
    id: string;
};

/**
 * 定义日志的详细级别，与 Koishi (reggol) 的模型对齐。
 * 数值越大，输出的日志越详细。
 */
enum LogLevel {
    // 级别 0: 完全静默，不输出任何日志
    SILENT = 0,
    // 级别 1: 只显示最核心的成功/失败信息
    ERROR = 1,
    // 级别 2: 显示常规信息、警告以及更低级别的所有信息
    INFO = 2,
    // 级别 3: 显示所有信息，包括详细的调试日志
    DEBUG = 3,
}

/** 描述一个模型在特定提供商中的位置 */
type ModelDescriptor = {
    providerName: string;
    modelId: string;
};

/** 模型切换策略 */
enum ModelSwitchingStrategy {
    Failover = "failover", // 故障转移 (默认)
    RoundRobin = "round-robin", // 轮询
}

/** 内容验证失败时的处理动作 */
enum ContentFailureAction {
    FailoverToNext = "failover_to_next", // 立即切换到下一个模型
    AugmentAndRetry = "augment_and_retry", // 增强提示词并在当前模型重试
}

/** 定义断路器策略 */
interface CircuitBreakerPolicy {
    /** 触发断路的连续失败次数 */
    failureThreshold: number;
    /** 断路器开启后的冷却时间 (秒) */
    cooldownSeconds: number;
}

interface ModelConfig {
    providerName?: string;
    modelId: string;
    abilities: ModelAbility[];
    parameters?: {
        temperature?: number;
        topP?: number;
        stream?: boolean;
        custom?: Array<{ key: string; type: "string" | "number" | "boolean" | "object"; value: string }>;
    };
    /** 超时策略 */
    timeoutPolicy?: TimeoutPolicy;
    /** 重试策略 */
    retryPolicy?: RetryPolicy;
    /** 断路器策略 */
    circuitBreakerPolicy?: CircuitBreakerPolicy;
}

/** 定义模型支持的能力 */
enum ModelAbility {
    Vision = "视觉",
    WebSearch = "网络搜索",
    Reasoning = "推理",
    FunctionCalling = "函数调用",
    Embedding = "嵌入",
    Chat = "对话",
}

interface ProviderConfig {
    name: string;
    type: any;
    baseURL?: string;
    apiKey: string;
    proxy?: string;
    models: ModelConfig[];
}

/** 定义超时策略 */
interface TimeoutPolicy {
    /** 首次响应超时 (秒) */
    firstTokenTimeout?: number;
    /** 总请求超时 (秒) */
    totalTimeout: number;
}

/** 定义重试策略 */
interface RetryPolicy {
    /** 最大重试次数 (在同一模型上) */
    maxRetries: number;
    /** 内容验证失败时的动作 */
    onContentFailure: ContentFailureAction;
}
/**
 * ConfigV1 - 由脚本自动生成的配置快照
 * 来源: Config in config.ts
 * 生成时间: 2025-09-08T15:17:04.525Z
 */
export interface ConfigV1 {
    /**
     * AI 模型、API密钥和模型组配置
     */
    modelService: {
        providers: ProviderConfig[];
        modelGroups: { name: string; models: ModelDescriptor[]; strategy: ModelSwitchingStrategy }[];
        task: {
            chat: string;
            embed: string;
        };
        readonly system?: {
            /**
             * 全局日志配置
             */
            logging: {
                level: LogLevel;
            };
            errorReporting: {
                enabled: boolean;
                pasteServiceUrl?: string;
                includeSystemInfo?: boolean;
            };
        };
    };
    /**
     * 智能体的性格、唤醒和响应逻辑
     */
    agentBehavior: {
        arousal: {
            /**
             * 允许 Agent 响应的频道
             */
            allowedChannels: ChannelDescriptor[];
            /**
             * 消息防抖时间 (毫秒)，防止短时间内对相同模式的重复响应
             */
            debounceMs: number;
        };
        willingness: {
            base: {
                /**
                 * 收到普通文本消息的基础分。这是对话的基石
                 */
                text: number | Eval.Expr<number, boolean> | ((session: Session) => number);
            };
            attribute: {
                /**
                 * 被 @ 提及时的额外加成。这是最高优先级的信号
                 */
                atMention: number | Eval.Expr<number, boolean> | ((session: Session) => number);
                /**
                 * 作为"回复/引用"出现时的额外加成。表示对话正在延续
                 */
                isQuote: number | Eval.Expr<number, boolean> | ((session: Session) => number);
                /**
                 * 在私聊场景下的额外加成。私聊通常期望更高的响应度
                 */
                isDirectMessage: number | Eval.Expr<number, boolean> | ((session: Session) => number);
            };
            interest: {
                /**
                 * 触发"高兴趣"的关键词列表
                 */
                keywords: string[] | Eval.Expr<string[], boolean> | ((session: Session) => string[]);
                /**
                 * 消息包含关键词时，应用此乘数。>1 表示增强，<1 表示削弱
                 */
                keywordMultiplier: number | Eval.Expr<number, boolean> | ((session: Session) => number);
                /**
                 * 默认乘数（当没有关键词匹配时）。设为1表示不影响
                 */
                defaultMultiplier: number | Eval.Expr<number, boolean> | ((session: Session) => number);
            };
            lifecycle: {
                /**
                 * 意愿值的最大上限
                 */
                maxWillingness: number | Eval.Expr<number, boolean> | ((session: Session) => number);
                /**
                 * 意愿值衰减到一半所需的时间（秒）。这是一个基础值，会受对话热度影响
                 */
                decayHalfLifeSeconds: number | Eval.Expr<number, boolean> | ((session: Session) => number);
                /**
                 * 将意愿值转换为回复概率的"激活门槛"
                 */
                probabilityThreshold: number | Eval.Expr<number, boolean> | ((session: Session) => number);
                /**
                 * 超过门槛后，转换为概率时的放大系数
                 */
                probabilityAmplifier: number | Eval.Expr<number, boolean> | ((session: Session) => number);
                /**
                 * 决定回复后，扣除的"发言精力惩罚"基础值
                 */
                replyCost: number | Eval.Expr<number, boolean> | ((session: Session) => number);
            };
            readonly system?: {
                /**
                 * 全局日志配置
                 */
                logging: {
                    level: LogLevel;
                };
                errorReporting: {
                    enabled: boolean;
                    pasteServiceUrl?: string;
                    includeSystemInfo?: boolean;
                };
            };
        };
        streamAction: boolean;
        heartbeat: number;
        prompt: {
            systemTemplate: string;
            userTemplate: string;
            multiModalSystemTemplate: string;
        };
        vision: {
            /**
             * 是否启用视觉功能
             */
            enabled: boolean;
            /**
             * 允许的图片类型
             */
            allowedImageTypes: string[];
            /**
             * 允许在上下文中包含的最大图片数量
             */
            maxImagesInContext: number;
            /**
             * 图片在上下文中的最大生命周期。
             * 一张图片在上下文中出现 N 次后将被视为"过期"，除非它被引用。
             */
            imageLifecycleCount: number;
            detail: "low" | "high" | "auto";
        };
        readonly system?: {
            /**
             * 全局日志配置
             */
            logging: {
                level: LogLevel;
            };
            errorReporting: {
                enabled: boolean;
                pasteServiceUrl?: string;
                includeSystemInfo?: boolean;
            };
        };
        /**
         * 当处理消息过程中收到新消息时的处理策略
         * - skip: 跳过此消息（默认行为）
         * - immediate: 处理完当前消息后立即处理新消息
         * - deferred: 等待安静期后处理被跳过的话题
         */
        newMessageStrategy: "skip" | "immediate" | "deferred";
        /**
         * 延迟处理策略的安静期时间（毫秒）
         * 当一段时间内没有新消息时才处理被跳过的话题
         */
        deferredProcessingTime?: number;
    };
    /**
     * 记忆、工具等扩展能力配置
     */
    capabilities: {
        memory: {
            coreMemoryPath: string;
        };
        /**
         * 对话历史记录的管理方式
         */
        history: {
            l1_memory: {
                /**
                 * 工作记忆中最多包含的消息数量，超出部分将被平滑裁剪
                 */
                maxMessages: number;
                /**
                 * pending 状态的轮次在多长时间内没有新消息后被强制关闭（秒）
                 */
                pendingTurnTimeoutSec: number;
                /**
                 * 保留完整 Agent 响应（思考、行动、观察）的最新轮次数
                 */
                keepFullTurnCount: number;
            };
            l2_memory: {
                /**
                 * 启用 L2 记忆检索
                 */
                enabled: boolean;
                /**
                 * 检索时返回的最大记忆片段数量
                 */
                retrievalK: number;
                /**
                 * 向量相似度搜索的最低置信度阈值，低于此值的结果将被过滤
                 */
                retrievalMinSimilarity: number;
                /**
                 * 每个语义记忆片段包含的消息数量
                 */
                messagesPerChunk: number;
                /**
                 * 是否扩展相邻chunk
                 */
                includeNeighborChunks: boolean;
            };
            l3_memory: {
                /**
                 * 启用 L3 日记功能
                 */
                enabled: boolean;
                /**
                 * 每日生成日记的时间 (HH:mm)
                 */
                diaryGenerationTime: string;
            };
            ignoreSelfMessage: boolean;
            dataRetentionDays: number;
            cleanupIntervalSec: number;
            readonly allowedChannels?: ChannelDescriptor[];
            readonly system?: {
                /**
                 * 全局日志配置
                 */
                logging: {
                    level: LogLevel;
                };
                errorReporting: {
                    enabled: boolean;
                    pasteServiceUrl?: string;
                    includeSystemInfo?: boolean;
                };
            };
        };
        tools: {
            extra?: { [x: string]: { [key: string]: any; enabled?: boolean } };
            /**
             * 高级选项
             */
            advanced?: {
                maxRetry?: number;
                retryDelay?: number;
                timeout?: number;
            };
            readonly system?: {
                /**
                 * 全局日志配置
                 */
                logging: {
                    level: LogLevel;
                };
                errorReporting: {
                    enabled: boolean;
                    pasteServiceUrl?: string;
                    includeSystemInfo?: boolean;
                };
            };
        };
    };
    /**
     * 资源服务配置
     */
    assetService: {
        storagePath: string;
        driver: "local";
        endpoint?: string;
        maxFileSize: number;
        downloadTimeout: number;
        autoClear: {
            enabled: boolean;
            intervalHours: number;
            maxAgeDays: number;
        };
        image: {
            processedCachePath: string;
            targetSize: number;
            maxSizeMB: number;
            gifProcessingStrategy: "firstFrame" | "stitch";
            gifFramesToExtract: number;
        };
        recoveryEnabled: boolean;
    };
    /**
     * 提示词相关配置
     */
    promptService: {
        /**
         * 在模板中用于注入所有扩展片段的占位符名称。
         */
        injectionPlaceholder?: string;
        /**
         * 模板渲染的最大深度，用于支持片段的二次渲染，同时防止无限循环。
         */
        maxRenderDepth?: number;
    };
    /**
     * 系统缓存、调试等底层设置
     */
    system: {
        /**
         * 全局日志配置
         */
        logging: {
            level: LogLevel;
        };
        errorReporting: {
            enabled: boolean;
            pasteServiceUrl?: string;
            includeSystemInfo?: boolean;
        };
    };
}
