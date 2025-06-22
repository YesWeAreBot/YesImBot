export const MIDDLEWARE_NAMES = {
    ERROR_HANDLING: "error-handling",
    CHECK_REPLY_CONDITION: "check-reply-condition",
    REASONING: "reasoning",
} as const;

// 数据库表名
export const MESSAGE_TABLE = "yesimbot.message";
export const MEMORY_TABLE = "yesimbot.memory_block";
export const INTERACTION_TABLE = "yesimbot.interaction";
export const LAST_REPLY_TABLE = "yesimbot.last_reply";
export const IMAGE_TABLE = "yesimbot.image";