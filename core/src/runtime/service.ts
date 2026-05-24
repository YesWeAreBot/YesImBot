import { join } from "node:path";

import { Agent } from "@yesimbot/agent/agent";
import { ChatModelRef } from "@yesimbot/agent/ai";
import { AgentSession, convertToLlm, SessionManager } from "@yesimbot/agent/session";
import { Bot, Context, Logger, Service } from "koishi";

import type { AthenaEvent } from "../adapter/types.js";
import { serializeEvent } from "../adapter/types.js";
import { createSystemPromptExtension } from "../extension/built-in/system-prompt.js";
import type { ChannelContext } from "../extension/types.js";
import { Delivery } from "./delivery/delivery.js";
import { buildAgentSessionConfig, persistDeliveryEvents } from "./helpers.js";
import { RuntimeSettingsManager, type PartialRuntimeSettings } from "./settings/manager.js";

interface ChannelIdentifier {
  platform: string;
  channelId: string;
  type: "private" | "group";
}

type ChannelKey = `${string}:${string}`;

interface SessionContext {
  agentSession: AgentSession;
  sessionManager: SessionManager;
  platform: string;
  channelId: string;
  type: "private" | "group";
  bot: Bot;
  delivery: Delivery;
}

export interface RuntimeConfig {
  basePath: string;
  chatModel: string;
  allowedChannels: ChannelIdentifier[];
  logLevel?: number;
  runtimeSettings?: PartialRuntimeSettings;
}

export class RuntimeService extends Service<RuntimeConfig> {
  static inject = ["yesimbot.model", "yesimbot.extension", "yesimbot.session", "yesimbot.adapter"];
  readonly logger: Logger;

  private _channels = new Map<ChannelKey, SessionContext>();
  private _globalSettingsManager?: RuntimeSettingsManager;

  constructor(
    public ctx: Context,
    public config: RuntimeConfig,
  ) {
    super(ctx, "yesimbot.runtime");
    this.logger = ctx.logger("yesimbot.runtime");
    this.logger.level = config.logLevel ?? 2;
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

    this._globalSettingsManager = new RuntimeSettingsManager({
      globalPath: globalSettingsPath,
      seed: this.config.runtimeSettings,
    });

    const createSessionContext = async (
      context: ChannelContext,
      sessionManager: SessionManager,
      bot: Bot,
    ): Promise<SessionContext> => {
      const { platform, channelId, type } = context;
      const agent = new Agent({
        model: chatModel.model,
        convertToLlm: (messages) => convertToLlm(messages),
      });

      // 注册 system-prompt 扩展（per-channel，通过 built-in factory 创建）
      const promptExtension = createSystemPromptExtension({
        basePath: this.config.basePath,
        resolveBotInfo: (_ctx) => ({
          selfId: bot.selfId,
          selfName: bot.user?.nick || bot.user?.name || "(unknown)",
        }),
      });

      // Create channel runtime via ExtensionService
      const channelRuntime = await this.ctx["yesimbot.extension"].createChannelRuntime(context, [
        promptExtension,
      ]);

      // Create RuntimeSettingsManager for dual-scope settings
      const channelDir = this.ctx["yesimbot.session"].getChannelDir(platform, channelId);
      const settingsManager = new RuntimeSettingsManager({
        globalPath: globalSettingsPath,
        localPath: join(channelDir, "settings.json"),
        seed: this.config.runtimeSettings,
      });

      const merged = settingsManager.settings;

      // Get adapter for this platform, falling back to generic
      const adapter =
        this.ctx["yesimbot.adapter"].get(platform) ?? this.ctx["yesimbot.adapter"].get("*");

      // Create Delivery using adapter's submitMessage
      const delivery = new Delivery({
        submitMessage: (text) => {
          if (!adapter?.submitMessage) {
            // Ultimate fallback: use bot.sendMessage directly
            return bot
              .sendMessage(channelId, text)
              .then(() => ({ ok: true as const }))
              .catch((error) => ({ ok: false as const, error }));
          }
          return adapter.submitMessage({
            platform,
            channelId,
            text,
            bot,
          });
        },
        settings: merged.delivery,
        logger: this.logger,
      });

      const agentSession = new AgentSession({
        agent,
        sessionManager,
        hookRunner: channelRuntime.hookRunner,
        ...buildAgentSessionConfig(merged),
      });

      // Apply extension tool snapshot atomically to AgentSession
      agentSession.applyToolState(channelRuntime.toolSnapshot);

      const sessionContext: SessionContext = {
        agentSession,
        sessionManager,
        platform,
        channelId,
        type,
        bot,
        delivery,
      };

      let agentStartedAt = 0;

      agentSession.subscribe((event) => {
        switch (event.type) {
          case "agent_start":
            agentStartedAt = Date.now();
            break;
          case "agent_end": {
            break;
          }
          case "turn_start":
            break;
          case "turn_end":
            break;
          case "message_start":
            break;
          case "message_update":
            break;
          case "message_end": {
            if (event.message.role === "assistant") {
              const textContent = event.message.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("");
              const reasoningContent = event.message.content
                .filter((part) => part.type === "reasoning")
                .map((part) => part.text)
                .join("");

              if (reasoningContent) {
                this.logger.info(`Agent reasoning:\n${reasoningContent}`);
              }
              if (textContent) {
                this.logger.info(`Agent response:\n${textContent}`);
                const modelElapsedMs = agentStartedAt > 0 ? Date.now() - agentStartedAt : 0;
                delivery
                  .deliver({
                    text: textContent,
                    modelElapsedMs,
                    channel: { platform, channelId, type },
                  })
                  .then((result) => {
                    persistDeliveryEvents(sessionManager, result.events);
                    for (const evt of result.events) {
                      this.logger.warn(`Delivery event: ${evt.kind} — ${evt.reason}`);
                    }
                  })
                  .catch((err) => {
                    this.logger.error("Delivery failed", err);
                  });
              }
            }
            break;
          }
          case "tool_execution_start":
            break;
          case "tool_execution_end":
            break;
          case "queue_update":
            break;
          case "compaction_start":
            break;
          case "compaction_end":
            break;
          case "auto_retry_start":
            break;
          case "auto_retry_end":
            break;
        }
      });

      return sessionContext;
    };

    this.ctx.on("session:new", async ({ platform, channelId, sessionManager }) => {
      const key: ChannelKey = `${platform}:${channelId}`;
      const existing = this._channels.get(key);
      if (existing) {
        await this.ctx["yesimbot.extension"].disposeChannelRuntime({
          platform,
          channelId,
          type: existing.type,
        });
        existing.agentSession.dispose();
        const newCtx = await createSessionContext(
          { platform, channelId, type: existing.type },
          sessionManager,
          existing.bot,
        );
        this._channels.set(key, newCtx);
        this.logger.info(`Session replaced for channel ${key}`);
      }
    });

    this.ctx.on("athena/event", async (event: AthenaEvent) => {
      const key: ChannelKey = `${event.source.platform}:${event.source.channelId}`;

      if (!this._channels.has(key)) {
        const sessionManager = await this.ctx["yesimbot.session"].getOrCreate(
          event.source.platform,
          event.source.channelId,
          event.source.conversationType === "private" ? "private" : "group",
        );

        const bot = event.metadata.bot;
        if (!bot) {
          this.logger.warn(`No bot reference available for channel ${key}, skipping`);
          return;
        }

        const sessionContext = await createSessionContext(
          {
            platform: event.source.platform,
            channelId: event.source.channelId,
            type: event.source.conversationType === "private" ? "private" : "group",
          },
          sessionManager,
          bot,
        );
        this._channels.set(key, sessionContext);
        this.logger.info(`Created new agent session for channel ${key}`);
      }
      const sessionContext = this._channels.get(key)!;

      const channelAllowed = isChannelAllowed(
        event.source.platform,
        event.source.channelId,
        event.source.conversationType === "private" ? "private" : "group",
        this.config.allowedChannels,
      );

      const shouldTriggerTurn = channelAllowed && event.metadata.triggerCandidate;

      // Format for LLM
      const formatted = await this.ctx["yesimbot.adapter"].formatters.format(event, {
        conversationType: event.source.conversationType,
        selfId: sessionContext.bot.selfId,
      });

      // Decide persistence
      if (formatted === null && !event.metadata.persist) return;
      if (!event.metadata.persist && !shouldTriggerTurn) return;

      const display = formatted !== null;
      const content = formatted ?? [];

      const options = shouldTriggerTurn
        ? { triggerTurn: true, deliverAs: "followUp" as const }
        : { triggerTurn: false };

      await sessionContext.agentSession.sendCustomMessage(
        {
          customType: "athena:event",
          content,
          display,
          details: serializeEvent(event),
        },
        options,
      );
    });
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

function isChannelAllowed(
  platform: string,
  channelId: string,
  type: "private" | "group",
  allowedChannels: ChannelIdentifier[],
) {
  /**
   * platform -> * matches all platforms
   * channelId -> * matches all channels under the specified platform
   */
  return allowedChannels.some((c) => {
    const platformMatch = c.platform === "*" || c.platform === platform;
    const channelMatch = c.channelId === "*" || c.channelId === channelId;
    const typeMatch = c.type === type;
    return platformMatch && channelMatch && typeMatch;
  });
}
