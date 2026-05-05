import type {} from "koishi";

import type { ModelRegistry } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.model": ModelRegistry;
  }
}

export type { LanguageModelV3 } from "@ai-sdk/provider";
export {
  addToolInputExamplesMiddleware,
  defaultEmbeddingSettingsMiddleware,
  defaultSettingsMiddleware,
  extractJsonMiddleware,
  extractReasoningMiddleware,
  simulateStreamingMiddleware,
  wrapLanguageModel,
  wrapProvider,
} from "ai";
export type { LanguageModel, LanguageModelMiddleware } from "ai";

export * from "./types";
