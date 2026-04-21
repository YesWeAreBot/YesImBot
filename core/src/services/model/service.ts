import type { ModelEntry, ModelProvider, ResolvedModelRegistration } from "@yesimbot/shared-model";
import { parseModelId } from "@yesimbot/shared-model";
import { Context, Schema, Service } from "koishi";

declare module "koishi" {
  interface Events {
    "yesimbot/set-model": (provider: string, modelId: string) => void;
  }
}

export interface ModelServiceConfig {
  logLevel?: number;
}

export class ModelService extends Service<ModelServiceConfig> {
  private providers = new Map<string, ModelProvider>();

  constructor(ctx: Context, config: ModelServiceConfig) {
    super(ctx, "yesimbot.model", true);
    this.config = config;
    this.logger.level = config.logLevel ?? 2;

    const command = ctx.command("yesimbot.model", "模型指令集", { authority: 3 });

    command.subcommand(".set <model:string>", "设置当前会话使用的模型").action((_, model) => {
      if (!model) return "请提供模型名称，格式为 provider:modelId";
      const parsed = parseModelId(model);
      if (!parsed) return `无效的模型格式: ${model}`;
      if (!this.providers.has(parsed.provider)) return `提供商未找到: ${parsed.provider}`;
      ctx.emit("yesimbot/set-model", parsed.provider, parsed.model);
      return `已设置模型: ${model}`;
    });

    command.subcommand(".list", "列出所有可用模型").action(() => {
      const models = this.listModels();
      if (models.length === 0) return "没有可用的模型";
      return "可用模型:\n" + models.map((m) => `- ${m.id}`).join("\n");
    });
  }

  private refreshSchemas(): void {
    const options: Schema<string>[] = [];
    for (const model of this.listModels()) {
      options.push(Schema.const(model.id).description(model.id));
    }
    options.push(Schema.string().description("Custom model (provider:model)"));
    this.ctx.schema.set("registry.chatModels", Schema.union(options).default(""));
  }

  register(provider: ModelProvider) {
    this.providers.set(provider.id, provider);
    this.refreshSchemas();
    this.logger.info(`Provider registered: ${provider.id}`);
  }

  unregister(id: string) {
    this.providers.delete(id);
    this.refreshSchemas();
    this.logger.info(`Provider unregistered: ${id}`);
  }

  resolve(fullId: string) {
    return this.resolveRegistration(fullId).model;
  }

  resolveRegistration(fullId: string): ResolvedModelRegistration {
    const parsed = parseModelId(fullId);
    if (!parsed) throw new Error(`Invalid model ID format: ${fullId}`);

    const provider = this.providers.get(parsed.provider);
    if (!provider) {
      throw new Error(
        `Provider "${parsed.provider}" not found. Available: [${this.listProviders().join(", ")}]`,
      );
    }

    const entry = provider.models().find((model) => model.id === parsed.model);
    if (!entry) {
      throw new Error(
        `Model "${parsed.model}" not found in provider "${parsed.provider}". Available: [${provider
          .models()
          .map((model) => model.id)
          .join(", ")}]`,
      );
    }

    return {
      fullId,
      providerId: parsed.provider,
      modelId: parsed.model,
      entry,
      model: provider.chat(parsed.model),
    };
  }

  resolveEmbedding(fullId: string) {
    const parsed = parseModelId(fullId);
    if (!parsed) throw new Error(`Invalid model ID format: ${fullId}`);
    const provider = this.providers.get(parsed.provider);
    if (!provider) throw new Error(`Provider "${parsed.provider}" not found`);
    if (!provider.embedding) {
      throw new Error(`Provider "${parsed.provider}" does not support embedding`);
    }
    return provider.embedding(parsed.model);
  }

  getProvider(id: string) {
    return this.providers.get(id);
  }

  listProviders() {
    return [...this.providers.keys()];
  }

  listModels(providerId?: string): ModelEntry[] {
    if (providerId) {
      const provider = this.providers.get(providerId);
      return provider ? provider.models() : [];
    }
    return [...this.providers.values()].flatMap((p) =>
      p.models().map((m) => ({ ...m, id: `${p.id}:${m.id}` })),
    );
  }
}
