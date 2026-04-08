import { hermesToolMiddleware } from "@ai-sdk-tool/parser";
import type { ModelRegistry, ResolvedModelRegistration } from "@yesimbot/shared-model";
import { wrapLanguageModel } from "ai";

export interface PrepareRuntimeModelOptions {
  registry: Pick<ModelRegistry, "resolveRegistration">;
  modelId: string;
  requiresTools: boolean;
  requiresReasoning: boolean;
}

export function prepareRuntimeModel({
  registry,
  modelId,
  requiresTools,
  requiresReasoning,
}: PrepareRuntimeModelOptions): ResolvedModelRegistration {
  const registration = registry.resolveRegistration(modelId);

  if (requiresReasoning && registration.entry.reasoning !== true) {
    throw new Error(`Model "${registration.fullId}" does not support reasoning`);
  }

  if (requiresTools && registration.entry.toolCall === false) {
    return {
      ...registration,
      model: wrapLanguageModel({
        model: registration.model,
        middleware: [hermesToolMiddleware],
      }),
    };
  }

  return registration;
}
