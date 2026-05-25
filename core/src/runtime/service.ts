import { join } from "node:path";

import { Agent } from "@yesimbot/agent/agent";
import { ChatModelRef } from "@yesimbot/agent/ai";
import { AgentSession, convertToLlm, HookRunner, SessionManager } from "@yesimbot/agent/session";
import { Bot, Context, Logger, Service, type Session } from "koishi";

import { AthenaBot } from "../bot/athena-bot.js";
import { createDefaultChatMessagePresenter, createPresenterRegistry } from "../bot/presenter.js";
import { createSpeakElementRegistry } from "../bot/speak-elements.js";
import { createSystemPromptExtension } from "../extension/built-in/system-prompt.js";
import type { BotInfo } from "../extension/built-in/system-prompt.js";
import type { Channel } from "../extension/types.js";
import { ChannelIdentifier, ChannelKey } from "../shared/types.js";
import { createChannelRuntime, type ChannelRuntime } from "./channel-runtime.js";
import { buildAgentSessionConfig } from "./helpers.js";
import { RuntimeSettingsManager, type PartialRuntimeSettings } from "./settings-manager.js";
import { WillingnessConfig, WillingnessManager } from "./willing.js";

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

export type RuntimeConfig = {
  basePath: string;
  chatModel: string;
  allowedChannels: ChannelIdentifier[];
  logLevel?: number;
  runtimeSettings?: PartialRuntimeSettings;
} & WillingnessConfig;

export class RuntimeService extends Service<RuntimeConfig> {
  static inject = ["yesimbot.model", "yesimbot.extension", "yesimbot.session", "yesimbot.bot"];
  readonly logger: Logger;

  private _channels = new Map<ChannelKey, SessionContext>();
  private _globalSettingsManager?: RuntimeSettingsManager;
  private _willingManager: WillingnessManager;
  private _channelBotInfo = new Map<ChannelKey, BotInfo>();
  private _chatModel?: ChatModelRef;
  private _globalSettingsPath?: string;
  private _disposeSessionNewHandler?: () => void;

  constructor(
    public ctx: Context,
    public config: RuntimeConfig & WillingnessConfig,
  ) {
    super(ctx, "yesimbot.runtime");
    this.logger = ctx.logger("yesimbot.runtime");
    this.logger.level = config.logLevel ?? 2;
    this._willingManager = new WillingnessManager(ctx, config, this.logger);
  }

  protected async start() {
    this.logger.info("Starting yesimbot runtime service");

    this._registerCommands();

    if (!this.config.chatModel) {
      this.ctx.logger.error("No chat model specified in config");
      return;
    }
    const globalSettingsPath = join(this.config.basePath, "settings.json");

    let chatModel: ChatModelRef;
    try {
      chatModel = this.ctx["yesimbot.model"].resolveChatModel(this.config.chatModel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ctx.logger.error(`Failed to resolve chat model: ${this.config.chatModel} (${message})`);
      return;
    }

    this._chatModel = chatModel;
    this._globalSettingsPath = globalSettingsPath;
    this._globalSettingsManager = new RuntimeSettingsManager({
      globalPath: globalSettingsPath,
      seed: this.config.runtimeSettings,
    });

    // Register system-prompt extension globally (resolves bot info per-channel at runtime)
    const promptExtension = createSystemPromptExtension({
      basePath: this.config.basePath,
      resolveBotInfo: (channel) => {
        const key: ChannelKey = `${channel.platform}:${channel.channelId}`;
        return this._channelBotInfo.get(key) ?? { selfId: "unknown", selfName: "(unknown)" };
      },
      getToolPromptContext: (channel) =>
        this.ctx["yesimbot.extension"].getPromptToolContext(channel),
      getSpeakElementPromptContext: (channel) => {
        const key: ChannelKey = `${channel.platform}:${channel.channelId}`;
        return {
          elements:
            this._channels.get(key)?.bot.getSpeakElementPrompts() ??
            this.ctx["yesimbot.extension"].getPromptSpeakElementContext(channel).elements,
        };
      },
    });
    await this.ctx["yesimbot.extension"].registerExtension(promptExtension);
    this.ctx["yesimbot.bot"].setSessionHandler(async (session) => {
      await this._handleKoishiSession(session);
    });

    this._disposeSessionNewHandler = this.ctx.on(
      "session:new",
      async ({ platform, channelId, sessionManager }) => {
        const key: ChannelKey = `${platform}:${channelId}`;
        const existing = this._channels.get(key);
        if (existing) {
          await this._disposeSessionContext(existing);
          const newCtx = await this._createSessionContext(
            { platform, channelId, type: existing.type },
            sessionManager,
            existing.koishiBot,
          );
          this._channels.set(key, newCtx);
          this.logger.info(`Session replaced for channel ${key}`);
        }
      },
    );
  }

  protected async stop() {
    this._disposeSessionNewHandler?.();
    this._disposeSessionNewHandler = undefined;
    this.ctx["yesimbot.bot"].clearSessionHandler();

    for (const sessionContext of this._channels.values()) {
      await this._disposeSessionContext(sessionContext);
    }

    this._channels.clear();
    this._channelBotInfo.clear();
  }

  private async _createSessionContext(
    channel: Channel,
    sessionManager: SessionManager,
    koishiBot: Bot,
  ): Promise<SessionContext> {
    const chatModel = this._chatModel;
    const globalSettingsPath = this._globalSettingsPath;
    if (!chatModel || !globalSettingsPath) {
      throw new Error("RuntimeService is not initialized");
    }

    const { platform, channelId, type } = channel;
    const agent = new Agent({
      model: chatModel.model,
      convertToLlm: (messages) => convertToLlm(messages),
    });

    const channelKey: ChannelKey = `${platform}:${channelId}`;
    this._channelBotInfo.set(channelKey, {
      selfId: koishiBot.selfId,
      selfName: koishiBot.user?.nick || koishiBot.user?.name || "(unknown)",
    });

    const channelDir = this.ctx["yesimbot.session"].getChannelDir(platform, channelId);
    const settingsManager = new RuntimeSettingsManager({
      globalPath: globalSettingsPath,
      localPath: join(channelDir, "settings.json"),
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
    presenters.registerBase("chat_message", createDefaultChatMessagePresenter());

    const speakElements = createSpeakElementRegistry();

    await this.ctx["yesimbot.extension"].createChannelRuntime({
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

    const athenaBot = new AthenaBot({
      channel: { ...channel, bot: koishiBot },
      presenters,
      speakElements,
      deliverySettings: merged.delivery,
      appendEntry: (customType, data) => sessionManager.appendCustomEntry(customType, data),
    });

    const runtime = createChannelRuntime({
      channel: { ...channel, bot: koishiBot },
      bot: athenaBot,
      agentSession,
      sessionManager,
      willingManager: this._willingManager,
      allowedChannels: this.config.allowedChannels,
    });

    return {
      agentSession,
      sessionManager,
      platform,
      channelId,
      type,
      koishiBot,
      bot: athenaBot,
      runtime,
    };
  }

  private async _getOrCreateSessionContext(
    key: ChannelKey,
    session: Session,
  ): Promise<SessionContext | undefined> {
    const existing = this._channels.get(key);
    if (existing) {
      return existing;
    }

    const koishiBot = session.bot;
    if (!koishiBot) {
      this.logger.warn(`No bot reference available for channel ${key}, skipping`);
      return undefined;
    }

    const platform = session.platform;
    const channelId = session.channelId;
    if (!platform || !channelId) {
      return undefined;
    }

    const type = session.isDirect ? "private" : "group";
    const sessionManager = await this.ctx["yesimbot.session"].getOrCreate(
      platform,
      channelId,
      type,
    );
    const sessionContext = await this._createSessionContext(
      {
        platform,
        channelId,
        type,
      },
      sessionManager,
      koishiBot,
    );
    this._channels.set(key, sessionContext);
    this.logger.info(`Created new agent session for channel ${key}`);
    return sessionContext;
  }

  private async _handleKoishiSession(session: Session): Promise<void> {
    if (!session.platform || !session.channelId) return;

    const key: ChannelKey = `${session.platform}:${session.channelId}`;
    const sessionContext = await this._getOrCreateSessionContext(key, session);
    if (!sessionContext) return;

    const event = sessionContext.bot.observe(session);
    if (!event) return;

    await sessionContext.runtime.handleEvent(event);
  }

  private async _disposeSessionContext(sessionContext: SessionContext): Promise<void> {
    await this.ctx["yesimbot.extension"].disposeChannelRuntime({
      platform: sessionContext.platform,
      channelId: sessionContext.channelId,
      type: sessionContext.type,
    });
    sessionContext.runtime.dispose();
    this._channelBotInfo.delete(`${sessionContext.platform}:${sessionContext.channelId}`);
  }

  private _registerCommands() {
    this.ctx.command("compact").action(async ({ session }) => {
      const cid = session?.cid as ChannelKey;
      if (!cid) {
        return "No channel context available";
      }
      const sessionContext = this._channels.get(cid);
      if (!sessionContext) {
        return "No session context found for this channel";
      }
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
