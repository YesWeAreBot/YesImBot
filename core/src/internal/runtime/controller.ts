import { join } from "node:path";

import type { ChatModelRef } from "@yesimbot/agent/ai";
import type { SessionManager } from "@yesimbot/agent/session";
import type { Bot, Context, Logger } from "koishi";

import { createSystemPromptExtension } from "../../services/extension/built-in/system-prompt.js";
import type { ModelService } from "../../services/model/index.js";
import type { ChannelIdentifier, ChannelKey } from "../../shared/types.js";
import type { BotModule } from "../bot/module.js";
import type { ObservedEvent } from "../bot/observer-types.js";
import type { ExtensionRegistry } from "../extension/types.js";
import type { SessionStore } from "../session/store.js";
import { WillingnessManager, type WillingnessConfig } from "./behavior.js";
import { ChannelSession, type ChannelSessionDeps } from "./session.js";
import { RuntimeSettingsManager, type PartialRuntimeSettings } from "./settings.js";

export type RuntimeControllerConfig = {
  basePath: string;
  chatModel: string;
  allowedChannels: ChannelIdentifier[];
  logLevel?: number;
  runtimeSettings?: PartialRuntimeSettings;
} & WillingnessConfig;

export interface RuntimeControllerDeps {
  ctx: Context;
  config: RuntimeControllerConfig;
  modelService: ModelService;
  extensionRegistry: ExtensionRegistry;
  sessionStore: SessionStore;
  botModule: BotModule;
}

export class RuntimeController {
  readonly name = "runtime-controller";
  readonly logger: Logger;

  private readonly ctx: Context;
  private readonly config: RuntimeControllerConfig;
  private readonly modelService: ModelService;
  private readonly extensionRegistry: ExtensionRegistry;
  private readonly sessionStore: SessionStore;
  private readonly botModule: BotModule;
  private readonly channels = new Map<ChannelKey, ChannelSession>();
  private readonly willingnessManager: WillingnessManager;

  private chatModel?: ChatModelRef;
  private globalSettingsPath?: string;
  private disposeSessionRotated?: () => void;
  private disposeObservedEventSubscription?: () => void;
  private started = false;
  private commandsRegistered = false;

  constructor(deps: RuntimeControllerDeps) {
    this.ctx = deps.ctx;
    this.config = deps.config;
    this.modelService = deps.modelService;
    this.extensionRegistry = deps.extensionRegistry;
    this.sessionStore = deps.sessionStore;
    this.botModule = deps.botModule;
    this.logger = deps.ctx.logger("yesimbot.runtime");
    this.logger.level = deps.config.logLevel ?? 2;
    this.willingnessManager = new WillingnessManager(deps.ctx, deps.config, this.logger);
  }

  async start(): Promise<void> {
    if (this.started) return;

    this.registerCommands();

    if (!this.config.chatModel) {
      this.ctx.logger.error("No chat model specified in config");
      return;
    }

    try {
      this.chatModel = this.modelService.resolveChatModel(this.config.chatModel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ctx.logger.error(`Failed to resolve chat model: ${this.config.chatModel} (${message})`);
      return;
    }

    this.globalSettingsPath = join(this.config.basePath, "settings.json");
    new RuntimeSettingsManager({
      globalPath: this.globalSettingsPath,
      seed: this.config.runtimeSettings,
    });

    await this.extensionRegistry.registerExtension(
      createSystemPromptExtension({
        basePath: this.config.basePath,
        resolveBotInfo: (channel) => {
          const key: ChannelKey = `${channel.platform}:${channel.channelId}`;
          const session = this.channels.get(key);
          return session?.getBotInfo() ?? { selfId: "unknown", selfName: "(unknown)" };
        },
        getToolPromptContext: (channel) => {
          const key: ChannelKey = `${channel.platform}:${channel.channelId}`;
          const session = this.channels.get(key);
          return (
            session?.getPromptToolContext() ?? {
              selectedTools: [],
              toolSnippets: {},
              promptGuidelines: [],
            }
          );
        },
        getSpeakElementPromptContext: (channel) => {
          const key: ChannelKey = `${channel.platform}:${channel.channelId}`;
          const session = this.channels.get(key);
          return session?.getPromptSpeakElementContext() ?? { elements: [] };
        },
      }),
    );

    this.disposeObservedEventSubscription = this.botModule.subscribeObservedEvents((observed) =>
      this.handleObservedEvent(observed),
    );
    this.disposeSessionRotated = this.sessionStore.subscribeSessionRotated((event) =>
      this.replaceSession(event.platform, event.channelId, event.type, event.sessionManager),
    );
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;

    this.disposeSessionRotated?.();
    this.disposeSessionRotated = undefined;
    this.disposeObservedEventSubscription?.();
    this.disposeObservedEventSubscription = undefined;

    for (const session of this.channels.values()) {
      session.dispose();
    }

    this.channels.clear();
    this.chatModel = undefined;
    this.globalSettingsPath = undefined;
    this.started = false;
  }

  async reloadAllChannels(trigger: string): Promise<{
    totalChannels: number;
    successCount: number;
    failureCount: number;
  }> {
    const definitions = this.extensionRegistry.getAllDefinitions();
    let successCount = 0;
    let failureCount = 0;

    for (const [key, session] of this.channels) {
      try {
        const result = await session.reloadExtensions(definitions);
        if (result.success) {
          successCount++;
        } else {
          failureCount++;
          this.logger.warn(`Channel ${key} reload failed: ${result.error ?? "unknown"}`);
        }
      } catch (error) {
        failureCount++;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Channel ${key} reload threw: ${message}`);
      }
    }

    if (failureCount > 0) {
      this.logger.warn(
        `Reload ${trigger}: ${successCount}/${this.channels.size} channels succeeded`,
      );
    }

    return {
      totalChannels: this.channels.size,
      successCount,
      failureCount,
    };
  }

  private createChannelSession(
    channel: { platform: string; channelId: string; type: "private" | "group" },
    sessionManager: SessionManager,
    koishiBot: Bot,
  ): ChannelSession {
    if (!this.chatModel || !this.globalSettingsPath) {
      throw new Error("RuntimeController is not initialized");
    }

    const deps: ChannelSessionDeps = {
      channel: { ...channel, bot: koishiBot },
      sessionManager,
      koishiBot,
      model: this.chatModel,
      settings: {
        globalPath: this.globalSettingsPath,
        localPath: this.sessionStore.getChannelSettingsPath(channel.platform, channel.channelId),
        seed: this.config.runtimeSettings,
      },
      behavior: {
        allowedChannels: this.config.allowedChannels,
        willingnessManager: this.willingnessManager,
      },
      extensions: {
        definitions: this.extensionRegistry.getAllDefinitions(),
      },
      bot: {
        presenterCatalog: this.botModule.getPresenterCatalog(),
      },
      logger: this.logger,
    };

    return new ChannelSession(deps);
  }

  private async reloadChannelSessionExtensions(session: ChannelSession): Promise<void> {
    const definitions = this.extensionRegistry.getAllDefinitions();

    const result = await session.reloadExtensions(definitions);
    if (result.success) {
      return;
    }

    this.logger.warn(
      `Initial extension reload failed for ${session.channelKey}: ${result.error ?? "unknown"}`,
    );
  }

  private async getOrCreateChannelSession(
    key: ChannelKey,
    channel: { platform: string; channelId: string; type: "private" | "group" },
    koishiBot: Bot,
  ): Promise<ChannelSession> {
    const existing = this.channels.get(key);
    if (existing?.koishiBot.selfId === koishiBot.selfId) {
      return existing;
    }

    if (existing) {
      existing.dispose();
    }

    const sessionManager = await this.sessionStore.getOrCreate({
      platform: channel.platform,
      channelId: channel.channelId,
      type: channel.type,
    });

    const session = this.createChannelSession(channel, sessionManager, koishiBot);
    this.channels.set(key, session);
    await this.reloadChannelSessionExtensions(session);
    return session;
  }

  private async handleObservedEvent(observed: ObservedEvent): Promise<void> {
    const { event, bot, originSession } = observed;
    const { platform, channelId, conversationType } = event.source;
    if (!platform || !channelId) return;

    const type = conversationType === "private" ? "private" : "group";
    const key: ChannelKey = `${platform}:${channelId}`;
    const session = await this.getOrCreateChannelSession(key, { platform, channelId, type }, bot);
    await session.handleEvent(event, { originSession });
  }

  private async replaceSession(
    platform: string,
    channelId: string,
    type: "private" | "group",
    sessionManager: SessionManager,
  ): Promise<void> {
    const key: ChannelKey = `${platform}:${channelId}`;
    const existing = this.channels.get(key);
    if (!existing) return;

    existing.dispose();

    const replacement = this.createChannelSession(
      { platform, channelId, type },
      sessionManager,
      existing.koishiBot,
    );
    this.channels.set(key, replacement);
    await this.reloadChannelSessionExtensions(replacement);
  }

  private registerCommands(): void {
    if (this.commandsRegistered) return;
    this.commandsRegistered = true;

    this.ctx.command("compact").action(async ({ session }) => {
      const cid = session?.cid as ChannelKey | undefined;
      if (!cid) return "No channel context available";

      const channelSession = this.channels.get(cid);
      if (!channelSession) return "No session context found for this channel";

      try {
        const result = await channelSession.agentSession.compact();
        return `TokensBefore: ${result.tokensBefore}\nSummary: ${result.summary}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to compact session for channel ${cid}: ${message}`);
        return `Failed to compact session: ${message}`;
      }
    });
  }
}
