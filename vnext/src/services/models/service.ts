import { join } from "node:path";

import { getEnvApiKey } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { Context, Schema, Service } from "koishi";

import type { ModelsServiceConfig } from "./types";

declare module "koishi" {
  interface Context {
    "athena.models": ModelsService;
  }
}

export class ModelsService extends Service<ModelsServiceConfig> {
  public readonly authStorage: AuthStorage;
  public readonly modelRegistry: ModelRegistry;

  constructor(ctx: Context, config: ModelsServiceConfig) {
    super(ctx, "athena.models", true);
    this.config = config;
    this.logger = ctx.logger("athena.models");
    this.logger.level = config.debugLevel ?? 2;

    this.authStorage = AuthStorage.create(join(config.dataPath, "auth.json"));
    this.modelRegistry = new ModelRegistry(this.authStorage, join(config.dataPath, "models.json"));
    this.applyRuntimeEnvOverrides();
  }

  private applyRuntimeEnvOverrides(): void {
    const providers = new Set(this.modelRegistry.getAll().map((model) => model.provider));
    for (const provider of providers) {
      const envKey = getEnvApiKey(provider);
      if (!envKey) {
        continue;
      }

      this.authStorage.setRuntimeApiKey(provider, envKey);
      this.logger.debug(`Applied runtime auth override for ${provider} from environment`);
    }
  }

  async start(): Promise<void> {
    this.refreshSchemas();
    this.registerCommands();
  }

  private registerCommands(): void {
    const athena = this.ctx.command("athena", "Athena bot management");

    athena.subcommand(".status", "View current channel session status").action(({ session }) => {
      if (!session) {
        return "No session context.";
      }

      if (!session.platform || !session.channelId) {
        return "No channel context.";
      }

      const sessionService = this.ctx["athena.session"];
      const status = sessionService.getStatus(session.platform, session.channelId);
      if (!status) {
        return "No active Athena session in this channel.";
      }

      const entry = sessionService.getEntry(session.platform, session.channelId);
      return [
        `Channel: ${status.channelKey}`,
        `Model: ${entry?.modelRef ?? "unknown"}`,
        `Streaming: ${status.isStreaming ? "yes" : "no"}`,
        `Bot connected: ${status.hasBot ? "yes" : "no"}`,
        `Session dir: ${status.sessionDir}`,
      ].join("\n");
    });

    const model = athena.subcommand(".model", "Model management");

    model
      .subcommand(".list", "List registered models")
      .alias("models")
      .action(() => {
        const models = this.modelRegistry.getAvailable();
        if (models.length === 0) {
          return "No registered models.";
        }

        return [
          "Registered models:",
          ...models.map((item) => `- ${item.provider}/${item.id}`),
        ].join("\n");
      });

    model
      .subcommand(".switch <name:string>", "Switch active model for this channel")
      .userFields(["authority"])
      .check(({ session }) => {
        if (!session?.user?.authority || session.user.authority < 2) {
          return "Permission denied: admin authority required.";
        }
      })
      .action(async ({ session }, name) => {
        if (!session || !name) {
          return "Usage: athena.model.switch <provider:modelId>";
        }

        if (!session.platform || !session.channelId) {
          return "No channel context.";
        }

        const models = this.modelRegistry.getAvailable();
        const target = models.find((item) => `${item.provider}:${item.id}` === name);
        if (!target) {
          return `Model "${name}" not found. Use 'athena.model.list' to see available models.`;
        }

        const sessionService = this.ctx["athena.session"];
        const switched = await sessionService.switchModel(
          session.platform,
          session.channelId,
          name,
        );
        if (!switched) {
          return "No active session in this channel. Send a message first.";
        }

        return `Model switched to ${name}. Next message will use the new model.`;
      });

    athena
      .subcommand(".reset", "Reset current channel session")
      .userFields(["authority"])
      .check(({ session }) => {
        if (!session?.user?.authority || session.user.authority < 2) {
          return "Permission denied: admin authority required.";
        }
      })
      .action(async ({ session }) => {
        if (!session) {
          return "No session context.";
        }

        if (!session.platform || !session.channelId) {
          return "No channel context.";
        }

        const sessionService = this.ctx["athena.session"];
        const deleted = await sessionService.resetSession(session.platform, session.channelId);
        return deleted
          ? "Session reset. A new session will be created on next message."
          : "No active session in this channel.";
      });
  }

  public refreshSchemas(): void {
    const models = this.modelRegistry.getAvailable();
    const options: Schema<string>[] = [];

    for (const model of models) {
      options.push(
        Schema.const(`${model.provider}:${model.id}` as string).description(
          `${model.provider}:${model.id}`,
        ),
      );
    }

    options.push(Schema.string().description("Custom model (provider:model)"));
    this.ctx.schema.set("registry.chatModels", Schema.union(options).default(""));
    this.logger.debug(`Refreshed model schemas: ${options.length - 1} models`);
  }

  async dispose(): Promise<void> {}
}
