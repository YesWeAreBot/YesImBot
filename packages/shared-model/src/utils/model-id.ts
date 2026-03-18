import { ModelSelector } from "../types/model";

export function createModelId(provider: string, model: string): string {
  return `${provider}:${model}`;
}

export function parseModelId(fullId: string): ModelSelector | null {
  const idx = fullId.indexOf(":");
  if (idx < 0) return null;
  return { provider: fullId.slice(0, idx), model: fullId.slice(idx + 1) };
}
