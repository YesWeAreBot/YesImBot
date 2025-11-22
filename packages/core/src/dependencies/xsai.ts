// 统一的 XSAI 适配导出层
// 说明：部分编辑器/打包器对 `export * from` 的值导出推断不稳定，
// 这里显式导出 Chat/Stream 相关的主入口，避免 “has no exported member” 报错。

// 提供商适配（可选使用）
export * from "@xsai-ext/providers-cloud";
export * from "@xsai-ext/providers-local";
export type { ChatProvider } from "@xsai-ext/shared-providers";
export * from "@xsai-ext/shared-providers";

// 基础能力
export type { EmbedManyOptions, EmbedManyResult, EmbedOptions, EmbedResult } from "@xsai/embed";
export * from "@xsai/embed";

// 文本生成（非流式）
export { generateText } from "@xsai/generate-text";
export type { GenerateTextResult } from "@xsai/generate-text";

// Chat 相关类型
export type {
  ChatOptions,
  CompletionStep,
  CompletionToolCall,
  CompletionToolResult,
  Message,
} from "@xsai/shared-chat";
export * from "@xsai/shared-chat";

// 文本生成（流式）
export { streamText } from "@xsai/stream-text";
export * from "@xsai/stream-text";

// 其他工具
export * from "@xsai/utils-chat";
