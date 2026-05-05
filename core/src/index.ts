import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  Agent,
  AgentSession,
  convertToLlm,
  ExtensionRegistry,
  SessionManager,
} from "@yesimbot/agent";
import { Bot, Context, Logger, Schema } from "koishi";

import { ChatMessage, sendAthenaMessage } from "./messages";
import { ModelService, ModelServiceConfig } from "./services/model";

interface Config extends ModelServiceConfig {
  chatModel: string;
}

export const name = "yesimbot";
export const inject = [];

export const Config = Schema.object({
  chatModel: Schema.dynamic("registry.chatModels"),
  basePath: Schema.path({ filters: ["directory"], allowCreate: true }).default("data/yesimbot"),
  modelsConfigPath: Schema.path({ filters: ["file"], allowCreate: true }),
  logLevel: Schema.union([0, 1, 2, 3]).default(2),
});

type ChannelKey = `${string}:${string}`;

interface SessionContext {
  agentSession: AgentSession;
  platform: string;
  channelId: string;
  bot: Bot;
}

class Runtime {
  static inject = ["yesimbot.model"];
  readonly logger: Logger;
  private extensionRegistry = new ExtensionRegistry();

  constructor(
    public ctx: Context,
    public config: Config,
  ) {
    this.logger = ctx.logger("yesimbot");
    this.logger.level = config.logLevel ?? 2;
    ctx.on("ready", this.start.bind(this));
  }

  private async start() {
    if (!this.config.chatModel) {
      this.ctx.logger.error("No chat model specified in config");
      return;
    }
    const chatModel = this.ctx["yesimbot.model"].resolveChatModel(this.config.chatModel);
    if (!chatModel) {
      this.ctx.logger.error(`Failed to resolve chat model: ${this.config.chatModel}`);
      return;
    }

    const channels = new Map<ChannelKey, SessionContext>();
    const sessionDir = resolve(this.config.basePath, "sessions");
    const sessionManager = SessionManager.create(this.config.basePath, sessionDir);

    this.ctx.middleware(async (session, next) => {
      const cid = session.cid as ChannelKey;
      if (!channels.has(cid)) {
        const agent = new Agent({
          model: chatModel.model,
          convertToLlm: convertToLlm,
        });
        const platform = session.platform;
        const channelId = session.channelId!;
        const agentSession = new AgentSession({
          cwd: this.config.basePath,
          agent,
          sessionManager,
          extensions: this.extensionRegistry.getAll(),
        });
        this.extensionRegistry.registerRunner(agentSession.extensionRunner);

        const sessionContext: SessionContext = {
          agentSession,
          platform,
          channelId,
          bot: session.bot,
        };

        agentSession.subscribe((event) => {
          this.ctx.logger.info(`Agent event: ${event.type}`);
          switch (event.type) {
            case "agent_start":
              break;
            case "agent_end": {
              for (const message of event.messages) {
                if (message.role === "assistant") {
                  const textContent = message.content
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join("");
                  const reasoningContent = message.content
                    .filter((part) => part.type === "reasoning")
                    .map((part) => part.text)
                    .join("");

                  if (reasoningContent) {
                    this.logger.info(`Agent reasoning:\n${reasoningContent}`);
                    sessionContext.bot.sendMessage(
                      sessionContext.channelId,
                      `[Reasoning]\n${reasoningContent}`,
                    );
                  }
                  if (textContent) {
                    this.logger.info(`Agent response:\n${textContent}`);
                    sessionContext.bot.sendMessage(sessionContext.channelId, textContent);
                  }
                }
              }
              break;
            }
            case "turn_start":
            case "turn_end":
            case "message_start":
            case "message_update":
            case "message_end":
            case "tool_execution_start":
            case "tool_execution_end":
            case "queue_update":
            case "compaction_start":
            case "compaction_end":
            case "auto_retry_start":
            case "auto_retry_end":
          }
        });
        channels.set(cid, sessionContext);
        this.logger.info(`Created new agent session for channel ${cid}`);
      }
      const sessionContext = channels.get(cid)!;

      await sendAthenaMessage(
        sessionContext.agentSession,
        {
          customType: "chat_message",
          content: String(session.content),
          display: true,
          details: {
            messageId: session.messageId,
            platform: session.platform,
            channelId: session.channelId,
            senderId: session.author.id,
            quoteMessageId: session.quote?.id,
            quoteMessageContent: session.quote?.content,
            timestamp: Date.now(),
          },
        } as ChatMessage,
        { triggerTurn: true, deliverAs: "followUp" },
      );

      return next();
    });
  }
}

export async function apply(ctx: Context, config: Config) {
  if (config.basePath) {
    config.basePath = resolve(ctx.baseDir, config.basePath);
    if (!existsSync(config.basePath)) {
      mkdirSync(config.basePath, { recursive: true });
    }
  }
  ctx.plugin(ModelService, config);
  ctx.plugin(Runtime, config);
}
