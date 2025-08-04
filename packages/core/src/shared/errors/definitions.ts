/**
 * @description 应用程序的统一错误定义
 * 每个定义都包含 code (错误码)、message (错误信息) 和给用户的 suggestion (建议)
 * 这种结构使错误处理更具声明性且保持一致
 */
export const ErrorDefinitions = {
    // --- LLM 相关错误 ---
    LLM: {
        BAD_REQUEST: {
            code: "LLM.BAD_REQUEST",
            message: "LLM API 请求因格式错误而失败",
            suggestion: "请检查您的请求参数，确保它们符合 API 的要求并已正确格式化",
        },

        INVALID_API_KEY: {
            code: "LLM.INVALID_API_KEY",
            message: "提供了无效的 LLM API 密钥",
            suggestion: "请仔细检查您的 API 密钥，确保其在插件配置中已正确设置。如果您使用的是云服务，请确保您有权访问指定的模型",
        },

        RATE_LIMIT_EXCEEDED: {
            code: "LLM.RATE_LIMIT_EXCEEDED",
            message: "LLM API 的请求频率超限",
            suggestion: "请稍等片刻再发起请求。如果您使用的是云服务，请考虑升级您的套餐或将请求分散在更长的时间段内",
        },

        PROVIDER_ERROR: {
            code: "LLM.PROVIDER_ERROR",
            message: "LLM 服务提供商内部发生错误",
            suggestion: "请检查服务商的文档以确保其设置正确。如果问题仍然存在，请考虑报告此问题",
        },

        REQUEST_FAILED: {
            code: "LLM.REQUEST_FAILED",
            message: (details: string) => `LLM API 请求失败：${details}`,
            suggestion: "请检查您的网络、API 密钥以及模型提供商的状态页面。这可能是由于频率限制、密钥无效或暂时的服务中断所致",
        },
        OUTPUT_PARSING_FAILED: {
            code: "LLM.OUTPUT_PARSING_FAILED",
            message: "解析 LLM 响应失败，输出不是有效的 JSON 格式",
            suggestion: "这通常是暂时的模型问题，请重试。如果问题持续存在，可能是模型不稳定或系统提示词需要调整以确保生成有效的 JSON",
        },
        TIMEOUT: {
            code: "LLM.TIMEOUT",
            message: (duration: number) => `对 LLM 的请求在 ${duration} 秒后超时`,
            suggestion: "模型响应时间过长。这可能是模型服务提供商的临时问题。如果此问题频繁发生，您可以尝试在模型设置中调高‘总超时’时间",
        },
    },
    // --- 配置错误 ---
    CONFIG: {
        MISSING: {
            code: "CONFIG.MISSING",
            message: (service: string, component: string) => `服务 '${service}' 中缺少 '${component}' 的配置`,
            suggestion: (component: string) => `请确保在插件设置中已正确配置 '${component}'`,
        },
        MISSING_MODEL_GROUP: {
            code: "CONFIG.MISSING_MODEL_GROUP",
            message: "未给 '聊天 (Chat)' 任务类型配置任何模型组",
            suggestion: "代理需要一个聊天模型才能运作。请前往“模型服务”设置，并为 '聊天' 任务类型至少配置一个模型",
        },
        INVALID: {
            code: "CONFIG.INVALID",
            message: (details: string) => `发现无效配置：${details}`,
            suggestion: "请检查插件配置并更正指定的字段。有关有效值，请参阅文档",
        },
        PROVIDER_INIT_FAILED: {
            code: "CONFIG.PROVIDER_INIT_FAILED",
            message: (providerId: string) => `初始化提供商失败：${providerId}`,
            suggestion: "请确保提供商的配置（如 API 密钥和基础 URL）正确无误，并检查日志中是否有相关的错误信息",
        },
    },
    // --- 任务调度与执行错误 ---
    TASK: {
        EXECUTION_FAILED: {
            code: "TASK.EXECUTION_FAILED",
            message: "执行计划任务时发生错误",
            suggestion: "这表明代理的处理周期内存在内部错误。请检查详细日志以获取更多信息",
        },
    },
    // --- 意愿计算错误 ---
    WILLINGNESS: {
        CALCULATION_FAILED: {
            code: "WILLINGNESS.CALCULATION_FAILED",
            message: "意愿计算失败",
            suggestion: "在决定是否回复时发生内部错误。请检查日志以获取更多详情",
        },
    },
    // --- 系统未知错误 ---
    SYSTEM: {
        UNKNOWN: {
            code: "SYSTEM.UNKNOWN",
            message: "发生未知错误",
            suggestion: "捕获到意外错误。请检查日志并考虑报告此问题",
        },
    },
    // --- 模型与模型组错误 ---
    MODEL: {
        UNAVAILABLE: {
            code: "MODEL.UNAVAILABLE",
            message: (modelId: string) => `无法找到或加载请求的模型 '${modelId}'`,
            suggestion: "请验证模型 ID 是否正确，以及对应的提供商是否已启用并正确配置",
        },
        GROUP_INIT_FAILED: {
            code: "MODEL.GROUP_INIT_FAILED",
            message: (groupName: string) => `模型组 '${groupName}' 初始化失败，因为它不包含任何可用的模型`,
            suggestion: "请检查模型组的配置。确保所列模型存在、其提供商已启用，并且它们具备所需的能力（例如 '聊天'）",
        },
        ALL_FAILED_IN_GROUP: {
            code: "MODEL.ALL_FAILED_IN_GROUP",
            message: (groupName: string) => `模型组 '${groupName}' 中的所有模型都未能处理请求`,
            suggestion:
                "这表明存在普遍性问题。请检查错误报告中的 'cause' 以了解单个模型的失败原因。这可能是网络问题或影响组内所有模型的问题",
        },
        RETRY_EXHAUSTED: {
            code: "MODEL.RETRY_EXHAUSTED",
            message: (modelId: string) => `模型 '${modelId}' 的所有重试次数已用尽`,
            suggestion: "该模型反复失败。请检查错误日志以找出根本原因（例如，网络问题、持续的 API 错误）",
        },
        NO_SUITABLE_MODEL: {
            code: "MODEL.NO_SUITABLE_MODEL",
            message: (groupName: string) => `在模型组 '${groupName}' 中未找到合适的模型`,
            suggestion: "请检查模型组的配置。确保所列模型存在、其提供商已启用，并且它们具备所需的能力（例如 '聊天'）",
        },
    },
    // --- 网络错误 ---
    NETWORK: {
        REQUEST_FAILED: {
            code: "NETWORK.REQUEST_FAILED",
            message: "网络请求失败",
            suggestion: "请检查您服务器的互联网连接和 DNS 设置。如果您正在使用代理，请确保其配置正确且正在运行",
        },
    },
    // --- 记忆相关错误 ---
    MEMORY: {
        PROVIDER_ERROR: {
            code: "MEMORY.PROVIDER_ERROR",
            message: "记忆提供商发生错误",
            suggestion: "请检查记忆提供商的配置并确保其设置正确。如果问题仍然存在，请考虑报告此问题",
        },
        SEARCH_FAILED: {
            code: "MEMORY.SEARCH_FAILED",
            message: "搜索记忆失败",
            suggestion: "这可能是由于内部错误。请检查日志以获取更多详情。如果问题仍然存在，请考虑报告此问题",
        },
        EMBEDDING_FAILED: {
            code: "MEMORY.EMBEDDING_FAILED",
            message: "为记忆生成嵌入向量失败",
            suggestion: "这可能是由于内部错误。请检查日志以获取更多详情。如果问题仍然存在，请考虑报告此问题",
        },
    },
} as const;

/**
 * 应用程序的统一错误码。
 * 使用常量对象而非枚举，以获得更好的灵活性和 Tree-shaking 效果。
 * 格式: 领域.类别或详情
 */
export const ErrorCodes = {
    // 服务相关错误
    SERVICE: {
        UNAVAILABLE: "SERVICE.UNAVAILABLE",
        INITIALIZATION_FAILURE: "SERVICE.INITIALIZATION_FAILURE",
        START_FAILURE: "SERVICE.START_FAILURE",
        STOP_FAILURE: "SERVICE.STOP_FAILURE",
    },
    // 通用系统错误
    SYSTEM: {
        UNKNOWN: "SYSTEM.UNKNOWN",
        DATABASE_ERROR: "SYSTEM.DATABASE_ERROR",
        NETWORK_ERROR: "SYSTEM.NETWORK_ERROR",
        SERVICE_UNAVAILABLE: "SYSTEM.SERVICE_UNAVAILABLE",
    },
    // 配置错误
    CONFIG: {
        MISSING: "CONFIG.MISSING",
        INVALID: "CONFIG.INVALID",
    },
    // 验证错误
    VALIDATION: {
        INVALID_INPUT: "VALIDATION.INVALID_INPUT",
        IS_NULL_OR_UNDEFINED: "VALIDATION.IS_NULL_OR_UNDEFINED",
    },
    // 资源错误
    RESOURCE: {
        NOT_FOUND: "RESOURCE.NOT_FOUND",
        CONFLICT: "RESOURCE.CONFLICT",
        EXHAUSTED: "RESOURCE.EXHAUSTED",
        STORAGE_FAILURE: "RESOURCE.STORAGE_FAILURE",
        LIMIT_EXCEEDED: "RESOURCE.LIMIT_EXCEEDED",
    },
    // 权限与认证
    AUTH: {
        PERMISSION_DENIED: "AUTH.PERMISSION_DENIED",
        AUTHENTICATION_FAILED: "AUTH.AUTHENTICATION_FAILED",
    },
    // LLM 相关错误
    LLM: {
        REQUEST_FAILED: "LLM.REQUEST_FAILED",
        TIMEOUT: "LLM.TIMEOUT",
        ADAPTER_ERROR: "LLM.ADAPTER_ERROR",
        RETRY_EXHAUSTED: "LLM.RETRY_EXHAUSTED",
        OUTPUT_PARSING_FAILED: "LLM.OUTPUT_PARSING_FAILED",
        MODEL_NOT_FOUND: "LLM.MODEL_NOT_FOUND",
    },
    // 网络错误
    NETWORK: {
        DOWNLOAD_FAILED: "NETWORK.DOWNLOAD_FAILED",
    },
    // 记忆相关错误
    MEMORY: {
        PROVIDER_ERROR: "MEMORY.PROVIDER_ERROR",
    },
    // 工具相关错误
    TOOL: {
        NOT_FOUND: "TOOL.NOT_FOUND",
        EXECUTION_ERROR: "TOOL.EXECUTION_ERROR",
        TIMEOUT: "TOOL.TIMEOUT",
    },
    // 操作相关错误
    OPERATION: {
        LOCK_TIMEOUT: "OPERATION.LOCK_TIMEOUT",
        CIRCUIT_BREAKER_OPEN: "OPERATION.CIRCUIT_BREAKER_OPEN",
        SERVICE_SHUTTING_DOWN: "OPERATION.SERVICE_SHUTTING_DOWN",
        RETRY_EXHAUSTED: "OPERATION.RETRY_EXHAUSTED",
    },
} as const;
