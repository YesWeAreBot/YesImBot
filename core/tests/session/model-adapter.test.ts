import { hermesToolMiddleware } from "@ai-sdk-tool/parser";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ResolvedModelRegistration } from "@yesimbot/shared-model";
import { describe, expect, it, vi } from "vitest";

import { prepareRuntimeModel } from "../../src/services/session/runtime/model-adapter";

const { wrapLanguageModelMock } = vi.hoisted(() => ({
  wrapLanguageModelMock: vi.fn(({ model }: { model: LanguageModelV3 }) => ({
    wrapped: true,
    model,
  })),
}));

vi.mock("ai", () => ({
  wrapLanguageModel: wrapLanguageModelMock,
}));

type FakeRegistry = {
  resolveRegistration: (fullId: string) => ResolvedModelRegistration;
};

function createLanguageModel(label: string): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "test-provider",
    modelId: label,
    defaultObjectGenerationMode: "json",
    supportsImageUrls: false,
    supportsUrl: () => false,
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  } as unknown as LanguageModelV3;
}

function createRegistry(
  registration: Omit<ResolvedModelRegistration, "fullId"> & { fullId?: string },
): FakeRegistry {
  return {
    resolveRegistration: vi.fn((fullId: string) => ({
      fullId,
      ...registration,
    })),
  };
}

describe("prepareRuntimeModel", () => {
  it("uses resolveRegistration to keep the original provider:modelId without auto provider fallback", () => {
    const model = createLanguageModel("alpha");
    const registry = createRegistry({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      entry: {
        id: "gpt-4o-mini",
        toolCall: true,
        reasoning: false,
      },
      model,
    });

    const prepared = prepareRuntimeModel({
      registry,
      modelId: "openai:gpt-4o-mini",
      requiresTools: false,
      requiresReasoning: false,
    });

    expect(registry.resolveRegistration).toHaveBeenCalledWith("openai:gpt-4o-mini");
    expect(prepared.fullId).toBe("openai:gpt-4o-mini");
    expect(prepared.providerId).toBe("openai");
    expect(prepared.modelId).toBe("gpt-4o-mini");
    expect(prepared.model).toBe(model);
    expect(wrapLanguageModelMock).not.toHaveBeenCalled();
  });

  it("wraps the raw model with hermesToolMiddleware when requiresTools is true but toolCall is false", () => {
    const model = createLanguageModel("beta");
    const registry = createRegistry({
      providerId: "openai",
      modelId: "hermes-2-pro",
      entry: {
        id: "hermes-2-pro",
        toolCall: false,
        reasoning: false,
      },
      model,
    });

    const prepared = prepareRuntimeModel({
      registry,
      modelId: "openai:hermes-2-pro",
      requiresTools: true,
      requiresReasoning: false,
    });

    expect(wrapLanguageModelMock).toHaveBeenCalledWith({
      model,
      middleware: [hermesToolMiddleware],
    });
    expect(prepared.model).toMatchObject({
      wrapped: true,
      model,
    });
  });

  it("fails fast when requiresReasoning is true and the model does not support reasoning", () => {
    const registry = createRegistry({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      entry: {
        id: "gpt-4o-mini",
        toolCall: true,
        reasoning: false,
      },
      model: createLanguageModel("gamma"),
    });

    expect(() =>
      prepareRuntimeModel({
        registry,
        modelId: "openai:gpt-4o-mini",
        requiresTools: false,
        requiresReasoning: true,
      }),
    ).toThrow(/does not support reasoning/);
  });

  it("keeps the original modelId when requiresReasoning is satisfied and surfaces seam errors directly", () => {
    const model = createLanguageModel("delta");
    const registry = createRegistry({
      providerId: "openai",
      modelId: "o3-mini",
      entry: {
        id: "o3-mini",
        toolCall: true,
        reasoning: true,
      },
      model,
    });

    const prepared = prepareRuntimeModel({
      registry,
      modelId: "openai:o3-mini",
      requiresTools: false,
      requiresReasoning: true,
    });

    expect(prepared.modelId).toBe("o3-mini");
    expect(prepared.model).toBe(model);

    const invalidRegistry: FakeRegistry = {
      resolveRegistration: vi.fn(() => {
        throw new Error("Invalid model ID format: missing-separator");
      }),
    };

    expect(() =>
      prepareRuntimeModel({
        registry: invalidRegistry,
        modelId: "missing-separator",
        requiresTools: false,
        requiresReasoning: false,
      }),
    ).toThrow(/Invalid model ID format/);

    const missingProviderRegistry: FakeRegistry = {
      resolveRegistration: vi.fn(() => {
        throw new Error('Provider "missing" not found. Available: [openai]');
      }),
    };

    expect(() =>
      prepareRuntimeModel({
        registry: missingProviderRegistry,
        modelId: "missing:model",
        requiresTools: false,
        requiresReasoning: false,
      }),
    ).toThrow(/Provider "missing" not found/);
  });

  it("fails fast when the registry does not expose resolveRegistration", () => {
    expect(() =>
      prepareRuntimeModel({
        registry: {
          resolve: vi.fn(() => createLanguageModel("legacy")),
        } as never,
        modelId: "openai:gpt-4o-mini",
        requiresTools: false,
        requiresReasoning: false,
      }),
    ).toThrow(/resolveRegistration/);
  });
});
