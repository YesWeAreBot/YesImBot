import type {} from "@koishijs/core";

import type { ModelRegistry } from "./types";

declare module "@koishijs/core" {
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
  jsonSchema,
  simulateStreamingMiddleware,
  wrapLanguageModel,
  wrapProvider,
} from "ai";
export type { LanguageModel, LanguageModelMiddleware } from "ai";
export * from "./types";
