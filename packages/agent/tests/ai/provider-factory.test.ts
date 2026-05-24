import type { EmbeddingModel, LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";

import { createProviderPlugin } from "../../src/ai/provider-factory.js";
import type { BaseProviderConfig, ProviderContext } from "../../src/ai/provider-factory.js";
import type { ModelProvider } from "../../src/ai/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLanguageModel(): LanguageModel {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "test-model",
    defaultObjectGenerationMode: "json",
    supportedUrls: {},
    doGenerate: async () => ({
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0 },
      content: [],
      response: { id: "test", timestamp: new Date(), modelId: "test" },
      providerMetadata: undefined,
      request: { body: "{}" },
    }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.close();
        },
      }),
    }),
  } as LanguageModel;
}

function createMockEmbeddingModel(): EmbeddingModel {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "test-embed",
    maxEmbeddingsPerCall: 100,
    supportsParallelCalls: true,
    doEmbed: async () => ({
      embeddings: [],
      usage: { tokens: 0 },
      response: { id: "test", timestamp: new Date(), modelId: "test-embed" },
    }),
  } as EmbeddingModel;
}

function createMockContext(): ProviderContext & {
  registered: ModelProvider[];
  disposeCallbacks: Array<() => void>;
} {
  const registered: ModelProvider[] = [];
  const disposeCallbacks: Array<() => void> = [];

  return {
    registered,
    disposeCallbacks,
    "yesimbot.model": {
      register(provider: ModelProvider) {
        registered.push(provider);
      },
      unregister(_providerId: string) {
        // no-op for tests
      },
    },
    on(event: "dispose", callback: () => void) {
      disposeCallbacks.push(callback);
    },
  };
}

interface TestConfig extends BaseProviderConfig {
  extra?: string;
}

const testConfig: TestConfig = {
  id: "test-provider",
  apiKey: "sk-test",
  chatModels: [
    { id: "model-a", toolCall: true, reasoning: false },
    { id: "model-b", toolCall: false, reasoning: true },
  ],
  embeddingModels: [{ id: "embed-a" }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createProviderPlugin", () => {
  it("returns a plugin with correct metadata", () => {
    const mockSchema = { type: "object" };
    const plugin = createProviderPlugin<TestConfig, object>({
      name: "test-plugin",
      defaultId: "test",
      capabilities: { chat: true, embedding: false },
      Config: mockSchema,
      createClient: () => ({}),
      chat: () => createMockLanguageModel(),
    });

    expect(plugin.name).toBe("test-plugin");
    expect(plugin.reusable).toBe(true);
    expect(plugin.inject).toEqual(["yesimbot.model"]);
    expect(plugin.Config).toBe(mockSchema);
    expect(typeof plugin.apply).toBe("function");
  });

  it("registers a provider on apply", () => {
    const ctx = createMockContext();
    const plugin = createProviderPlugin<TestConfig, object>({
      name: "test-plugin",
      defaultId: "test",
      capabilities: { chat: true, embedding: false },
      createClient: () => ({}),
      chat: () => createMockLanguageModel(),
    });

    plugin.apply(ctx, testConfig);

    expect(ctx.registered).toHaveLength(1);
    const provider = ctx.registered[0]!;
    expect(provider.id).toBe("test-provider");
    expect(provider.capabilities).toEqual({ chat: true, embedding: false });
    expect(provider.chatModels()).toEqual(testConfig.chatModels);
    expect(provider.embeddingModels()).toEqual([]);
  });

  it("chat() delegates to the provided chat adapter", () => {
    const mockModel = createMockLanguageModel();
    const chatAdapter = vi.fn<() => LanguageModel>(() => mockModel);

    const ctx = createMockContext();
    const plugin = createProviderPlugin<TestConfig, object>({
      name: "test-plugin",
      defaultId: "test",
      capabilities: { chat: true, embedding: false },
      createClient: () => ({ sdk: true }),
      chat: chatAdapter,
    });

    plugin.apply(ctx, testConfig);
    const provider = ctx.registered[0]!;

    const result = provider.chat("model-a");
    expect(result).toBe(mockModel);
    expect(chatAdapter).toHaveBeenCalledWith({ sdk: true }, "model-a", testConfig);
  });

  it("embedding() throws when capabilities.embedding is false", () => {
    const ctx = createMockContext();
    const plugin = createProviderPlugin<TestConfig, object>({
      name: "test-plugin",
      defaultId: "test",
      capabilities: { chat: true, embedding: false },
      createClient: () => ({}),
      chat: () => createMockLanguageModel(),
    });

    plugin.apply(ctx, testConfig);
    const provider = ctx.registered[0]!;

    expect(() => provider.embedding("embed-a")).toThrow(
      'Provider "test-provider" does not support embedding',
    );
  });

  it("embedding() delegates to the provided adapter when capabilities.embedding is true", () => {
    const mockEmbedding = createMockEmbeddingModel();
    const embeddingAdapter = vi.fn<() => EmbeddingModel>(() => mockEmbedding);

    const ctx = createMockContext();
    const plugin = createProviderPlugin<TestConfig, object>({
      name: "test-plugin",
      defaultId: "test",
      capabilities: { chat: true, embedding: true },
      createClient: () => ({}),
      chat: () => createMockLanguageModel(),
      embedding: embeddingAdapter,
    });

    plugin.apply(ctx, testConfig);
    const provider = ctx.registered[0]!;

    const result = provider.embedding("embed-a");
    expect(result).toBe(mockEmbedding);
    expect(embeddingAdapter).toHaveBeenCalledWith({}, "embed-a", testConfig);
  });

  it("embeddingModels returns config.embeddingModels when embedding is supported", () => {
    const ctx = createMockContext();
    const plugin = createProviderPlugin<TestConfig, object>({
      name: "test-plugin",
      defaultId: "test",
      capabilities: { chat: true, embedding: true },
      createClient: () => ({}),
      chat: () => createMockLanguageModel(),
      embedding: () => createMockEmbeddingModel(),
    });

    plugin.apply(ctx, testConfig);
    const provider = ctx.registered[0]!;

    expect(provider.embeddingModels()).toEqual([{ id: "embed-a" }]);
  });

  it("embeddingModels returns empty array when config.embeddingModels is undefined", () => {
    const configNoEmbed: TestConfig = {
      id: "test-provider",
      apiKey: "sk-test",
      chatModels: [{ id: "model-a" }],
    };

    const ctx = createMockContext();
    const plugin = createProviderPlugin<TestConfig, object>({
      name: "test-plugin",
      defaultId: "test",
      capabilities: { chat: true, embedding: true },
      createClient: () => ({}),
      chat: () => createMockLanguageModel(),
      embedding: () => createMockEmbeddingModel(),
    });

    plugin.apply(ctx, configNoEmbed);
    const provider = ctx.registered[0]!;

    expect(provider.embeddingModels()).toEqual([]);
  });

  it("registers a dispose callback", () => {
    const ctx = createMockContext();
    const plugin = createProviderPlugin<TestConfig, object>({
      name: "test-plugin",
      defaultId: "test",
      capabilities: { chat: true, embedding: false },
      createClient: () => ({}),
      chat: () => createMockLanguageModel(),
    });

    plugin.apply(ctx, testConfig);

    expect(ctx.disposeCallbacks).toHaveLength(1);
  });

  it("passes config extra fields through to chat adapter", () => {
    const chatAdapter = vi.fn<
      (client: object, modelId: string, config: TestConfig) => LanguageModel
    >(() => createMockLanguageModel());
    const configWithExtra: TestConfig = {
      ...testConfig,
      extra: "custom-value",
    };

    const ctx = createMockContext();
    const plugin = createProviderPlugin<TestConfig, object>({
      name: "test-plugin",
      defaultId: "test",
      capabilities: { chat: true, embedding: false },
      createClient: () => ({}),
      chat: chatAdapter,
    });

    plugin.apply(ctx, configWithExtra);
    ctx.registered[0]!.chat("model-a");

    expect(chatAdapter).toHaveBeenCalledWith(
      {},
      "model-a",
      expect.objectContaining({ extra: "custom-value" }),
    );
  });
});
