import { join } from "node:path";

import { Agent } from "@yesimbot/agent/agent";
import type { ChatModelRef } from "@yesimbot/agent/ai";
import {
  AgentSession,
  convertToLlm,
  HookRunner,
  type SessionManager,
} from "@yesimbot/agent/session";
import type { Bot, Context, Logger } from "koishi";

import {
  createSystemPromptExtension,
  type BotInfo,
} from "../../services/extension/built-in/system-prompt.js";
import type { Channel, ExtensionRegistry } from "../../services/extension/types.js";
import type { ModelService } from "../../services/model/index.js";
import type { ChannelIdentifier, ChannelKey } from "../../shared/types.js";
import { AthenaBot } from "../bot/bot.js";
import type { BotModule } from "../bot/module.js";
import type { ObservedEvent } from "../bot/observer-types.js";
import { createPresenterRegistry } from "../bot/presentation.js";
import { createSpeakElementRegistry } from "../bot/speak.js";
import type { ExtensionRuntimeManager } from "../extension/runtime.js";
import type { SessionStore } from "../session/store.js";
import { WillingnessManager, type WillingnessConfig } from "./behavior.js";
import { createChannelRuntime, type ChannelRuntime } from "./channel.js";
import { buildAgentSessionConfig } from "./helpers.js";
import { RuntimeSettingsManager, type PartialRuntimeSettings } from "./settings.js";

interface SessionContext {
  agentSession: AgentSession;
  sessionManager: SessionManager;
  platform: string;
  channelId: string;
  type: "private" | "group";
  koishiBot: Bot;
  bot: AthenaBot;
  runtime: ChannelRuntime;
}

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
  extensionRuntimeManager: ExtensionRuntimeManager;
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
  private readonly extensionRuntimeManager: ExtensionRuntimeManager;
  private readonly sessionStore: SessionStore;
  private readonly botModule: BotModule;
  private readonly channels = new Map<ChannelKey, SessionContext>();
  private readonly channelBotInfo = new Map<ChannelKey, BotInfo>();
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
    this.extensionRuntimeManager = deps.extensionRuntimeManager;
    this.sessionStore = deps.sessionStore;
    this.botModule = deps.botModule;
    this.logger = deps.ctx.logger("yesimbot-core.runtime-controller");
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
          return this.channelBotInfo.get(key) ?? { selfId: "unknown", selfName: "(unknown)" };
        },
        getToolPromptContext: (channel) =>
          this.extensionRuntimeManager.getPromptToolContext(channel),
        getSpeakElementPromptContext: (channel) => {
          const key: ChannelKey = `${channel.platform}:${channel.channelId}`;
          return {
            elements:
              this.channels.get(key)?.bot.getSpeakElementPrompts() ??
              this.extensionRuntimeManager.getPromptSpeakElementContext(channel).elements,
          };
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

    for (const sessionContext of this.channels.values()) {
      await this.disposeSessionContext(sessionContext);
    }

    this.channels.clear();
    this.channelBotInfo.clear();
    this.chatModel = undefined;
    this.globalSettingsPath = undefined;
    this.started = false;
  }

  private async createSessionContext(
    channel: Channel,
    sessionManager: SessionManager,
    koishiBot: Bot,
  ): Promise<SessionContext> {
    if (!this.chatModel || !this.globalSettingsPath) {
      throw new Error("RuntimeController is not initialized");
    }

    const agent = new Agent({
      model: this.chatModel.model,
      convertToLlm: (messages) => convertToLlm(messages),
    });
    const channelKey: ChannelKey = `${channel.platform}:${channel.channelId}`;
    this.channelBotInfo.set(channelKey, {
      selfId: koishiBot.selfId,
      selfName: koishiBot.user?.nick || koishiBot.user?.name || "(unknown)",
    });

    const settingsManager = new RuntimeSettingsManager({
      globalPath: this.globalSettingsPath,
      localPath: this.sessionStore.getChannelSettingsPath(channel.platform, channel.channelId),
      seed: this.config.runtimeSettings,
    });
    const merged = settingsManager.settings;

    let agentSession!: AgentSession;
    const hookRunner = new HookRunner(() => ({
      sessionManager,
      model: agent.state.model,
      isIdle: () => !agent.state.isStreaming,
      signal: agent.signal,
      abort: () => agent.abort(),
      hasPendingMessages: () => agent.hasQueuedMessages(),
      getContextUsage: () => agentSession.getContextUsage(),
      compact: (options) => {
        void agentSession
          .compact(options?.customInstructions)
          .then(options?.onComplete)
          .catch(options?.onError);
      },
      getSystemPrompt: () => agent.state.systemPrompt,
    }));

    agentSession = new AgentSession({
      agent,
      sessionManager,
      hookRunner,
      ...buildAgentSessionConfig(merged),
    });

    const presenters = createPresenterRegistry();
    this.botModule.applyPresentersTo(presenters);
    const speakElements = createSpeakElementRegistry();

    await this.extensionRuntimeManager.createChannelRuntime({
      channel: { ...channel, bot: koishiBot },
      hookRunner,
      sessionManager,
      applyToolState: (snapshot) => agentSession.applyToolState(snapshot),
      sendMessage: async (message, options) =>
        agentSession.sendCustomMessage(message as never, options as never),
      sendUserMessage: async (content, options) =>
        agentSession.sendUserMessage(content as never, options as never),
      appendEntry: (customType, data) => sessionManager.appendCustomEntry(customType, data),
      setSessionName: (name) => sessionManager.appendSessionInfo(name),
      getSessionName: () => sessionManager.getSessionName(),
      getActiveTools: () => agentSession.getActiveToolNames(),
      setActiveTools: (toolNames) => agentSession.setActiveToolsByName(toolNames),
      registerSpeakElement: (definition) => speakElements.register(definition),
    });

    const bot = new AthenaBot({
      channel: { ...channel, bot: koishiBot },
      presenters,
      speakElements,
      deliverySettings: merged.delivery,
      appendEntry: (customType, data) => sessionManager.appendCustomEntry(customType, data),
    });
    const runtime = createChannelRuntime({
      channel: { ...channel, bot: koishiBot },
      bot,
      agentSession,
      sessionManager,
      willingManager: this.willingnessManager,
      allowedChannels: this.config.allowedChannels,
    });

    return {
      agentSession,
      sessionManager,
      platform: channel.platform,
      channelId: channel.channelId,
      type: channel.type,
      koishiBot,
      bot,
      runtime,
    };
  }

  private async getOrCreateSessionContext(
    key: ChannelKey,
    channel: { platform: string; channelId: string; type: "private" | "group" },
    koishiBot: Bot,
  ): Promise<SessionContext> {
    const existing = this.channels.get(key);
    if (existing?.koishiBot.selfId === koishiBot.selfId) {
      return existing;
    }

    if (existing) {
      await this.disposeSessionContext(existing);
    }

    const sessionManager = await this.sessionStore.getOrCreate({
      platform: channel.platform,
      channelId: channel.channelId,
      type: channel.type,
      assignee: koishiBot.selfId,
    });
    const sessionContext = await this.createSessionContext(channel, sessionManager, koishiBot);
    this.channels.set(key, sessionContext);
    return sessionContext;
  }

  private async handleObservedEvent(observed: ObservedEvent): Promise<void> {
    const { event, bot, originSession } = observed;
    const { platform, channelId, conversationType } = event.source;
    if (!platform || !channelId) return;

    const type = conversationType === "private" ? "private" : "group";
    const key: ChannelKey = `${platform}:${channelId}`;
    const sessionContext = await this.getOrCreateSessionContext(
      key,
      { platform, channelId, type },
      bot,
    );
    await sessionContext.runtime.handleEvent(event, { originSession });
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

    await this.disposeSessionContext(existing);
    const replacement = await this.createSessionContext(
      { platform, channelId, type },
      sessionManager,
      existing.koishiBot,
    );
    this.channels.set(key, replacement);
  }

  private async disposeSessionContext(sessionContext: SessionContext): Promise<void> {
    await this.extensionRuntimeManager.disposeChannelRuntime({
      platform: sessionContext.platform,
      channelId: sessionContext.channelId,
      type: sessionContext.type,
    });
    sessionContext.runtime.dispose();
    this.channelBotInfo.delete(`${sessionContext.platform}:${sessionContext.channelId}`);
  }

  private registerCommands(): void {
    if (this.commandsRegistered) return;
    this.commandsRegistered = true;

    this.ctx.command("compact").action(async ({ session }) => {
      const cid = session?.cid as ChannelKey | undefined;
      if (!cid) return "No channel context available";

      const sessionContext = this.channels.get(cid);
      if (!sessionContext) return "No session context found for this channel";

      try {
        const result = await sessionContext.agentSession.compact();
        return `TokensBefore: ${result.tokensBefore}\nSummary: ${result.summary}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to compact session for channel ${cid}: ${message}`);
        return `Failed to compact session: ${message}`;
      }
    });
  }
}
