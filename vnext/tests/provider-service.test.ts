import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Model } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";

const { schemaSetSpy, getAllSpy } = vi.hoisted(() => ({
  schemaSetSpy: vi.fn(),
  getAllSpy: vi.fn(),
}));

interface MockSchemaOption {
  const?: string;
  label?: string;
  description: (text: string) => MockSchemaOption;
}

interface MockSchemaRoot {
  list: Array<{ const?: string; description?: string }>;
  defaultValue?: string;
  default: (value: string) => MockSchemaRoot;
}

function createOption(value?: string): MockSchemaOption {
  return {
    const: value,
    label: undefined,
    description(text: string): MockSchemaOption {
      this.label = text;
      return this;
    },
  };
}

vi.mock("koishi", () => {
  const Schema = {
    const(value: string): MockSchemaOption {
      return createOption(value);
    },
    string(): MockSchemaOption {
      return createOption();
    },
    union(options: MockSchemaOption[]): MockSchemaRoot {
      const root: MockSchemaRoot = {
        list: options.map((option) => ({
          const: option.const,
          description: option.label,
        })),
        defaultValue: undefined,
        default(value: string): MockSchemaRoot {
          this.defaultValue = value;
          return this;
        },
      };
      return root;
    },
  };

  class MockContext {
    [key: string]: unknown;

    schema = {
      set: schemaSetSpy,
    };

    logger(_name: string) {
      return { level: 0, debug: vi.fn() };
    }
  }

  class MockService<TConfig> {
    public ctx: Record<string, unknown>;
    public config!: TConfig;
    public logger: { level?: number; debug: (message: string) => void } = {
      debug: vi.fn(),
    };

    constructor(ctx: Record<string, unknown>, serviceId: string) {
      this.ctx = ctx;
      ctx[serviceId] = this;
    }
  }

  return {
    Schema,
    Context: MockContext,
    Service: MockService,
  };
});

import { Context } from "koishi";

describe("ModelsService behavior scaffold", () => {
  async function loadModelsService() {
    const serviceModulePath = "../src/services/models/service";
    return import(serviceModulePath);
  }

  function createModel(provider: string, id: string): Model<"openai-completions"> {
    return {
      provider,
      id,
      name: `${provider}:${id}`,
      api: "openai-completions",
      baseUrl: "https://example.com",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1,
      maxTokens: 1,
    };
  }

  function createContext(models: Model<"openai-completions">[]): Context {
    schemaSetSpy.mockReset();
    getAllSpy.mockReset();
    getAllSpy.mockReturnValue(models);

    const ctx = new Context();

    vi.mocked(
      (
        ctx as unknown as {
          command: (name: string, desc: string) => { action: (fn: () => unknown) => void };
        }
      ).command,
      {
        partial: true,
      },
    );

    return ctx;
  }

  it("ModelsService exposes refreshSchemas()", async () => {
    const { ModelsService } = await loadModelsService();
    const ctx = createContext([]);
    const service = new ModelsService(ctx, { dataPath: "/tmp/.athena" });

    expect(service.refreshSchemas).toBeTypeOf("function");
  });

  it('refreshSchemas() calls ctx.schema.set("registry.chatModels", ...)', async () => {
    const { ModelsService } = await loadModelsService();
    const ctx = createContext([]);
    const service = new ModelsService(ctx, { dataPath: "/tmp/.athena" });

    service.refreshSchemas();

    expect(schemaSetSpy).toHaveBeenCalledTimes(1);
    expect(schemaSetSpy).toHaveBeenCalledWith("registry.chatModels", expect.anything());
  });

  it("schema options include provider:modelId strings from modelRegistry.getAll()", async () => {
    const { ModelsService } = await loadModelsService();
    const ctx = createContext([createModel("openai", "gpt-4.1"), createModel("deepseek", "chat")]);
    const service = new ModelsService(ctx, { dataPath: "/tmp/.athena" });

    service.refreshSchemas();

    const schema = schemaSetSpy.mock.calls[0]?.[1] as {
      list?: Array<{ const?: string; description?: string }>;
    };
    const values = (schema.list ?? []).map((item) => item.const).filter(Boolean);
    expect(values).toContain("openai:gpt-4.1");
    expect(values).toContain("deepseek:chat");
    expect(getAllSpy).toHaveBeenCalledTimes(1);
  });

  it("schema union includes Schema.string().description('Custom model (provider:model)')", async () => {
    const { ModelsService } = await loadModelsService();
    const ctx = createContext([]);
    const service = new ModelsService(ctx, { dataPath: "/tmp/.athena" });

    service.refreshSchemas();

    const schema = schemaSetSpy.mock.calls[0]?.[1] as {
      list?: Array<{ const?: string; description?: string }>;
    };
    const descriptions = (schema.list ?? []).map((item) => item.description).filter(Boolean);
    expect(descriptions).toContain("Custom model (provider:model)");
  });

  it("start() calls refreshSchemas()", async () => {
    const { ModelsService } = await loadModelsService();
    const ctx = createContext([createModel("openai", "gpt-4.1")]);
    const service = new ModelsService(ctx, { dataPath: "/tmp/.athena" });
    const refreshSpy = vi.spyOn(service, "refreshSchemas");

    await service.start();

    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("implementation does not import ai-sdk or AbstractProvider", () => {
    const serviceSource = readFileSync(
      resolve(import.meta.dirname, "../src/services/models/service.ts"),
      "utf8",
    );

    expect(serviceSource).not.toMatch(/@ai-sdk\//);
    expect(serviceSource).not.toMatch(/from\s+["']ai["']/);
    expect(serviceSource).not.toMatch(/AbstractProvider/);
  });
});
