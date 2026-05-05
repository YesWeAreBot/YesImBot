import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  Agent,
  AgentMessage,
  AgentSession,
  convertToLlm,
  ExtensionRegistry,
  SessionManager,
} from "@yesimbot/agent";
import { jsonSchema } from "@yesimbot/shared-model";
import { Bot, Context, Logger, Schema } from "koishi";

import { AthenaMessage, ChatMessage, sendAthenaMessage } from "./messages";
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
    const ctx = this.ctx;
    this.extensionRegistry.add({
      id: "tool-utils",
      setup(api) {
        ctx.logger.info("Setting up tool-utils extension");
        api.registerTool<{ city: string; unit: string }>({
          name: "get_weather",
          description: "Get weather information for a location",
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              city: { type: "string", description: "City name" },
              unit: { type: "string", enum: ["C", "F"], description: "Temperature unit" },
            },
            required: ["city"],
          }),
          execute: async ({ city, unit }) => {
            ctx.logger.info(`Executing get_weather tool with city=${city} and unit=${unit}`);
            // Mock implementation - replace with real API call
            const temp = city === "New York" ? 25 : 30;
            const tempStr = unit === "F" ? `${temp * 1.8 + 32} °F` : `${temp} °C`;
            return {
              type: "text",
              value: `The current temperature in ${city} is ${tempStr}.`,
            };
          },
        });

        api.on("provider:before-request", ({ type, payload }) => {
          console.log(payload);
        });
      },
    });
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
          convertToLlm: (messages) => {
            let llmMessages: AgentMessage[] = [];
            for (const message of messages) {
              if (message.role === "custom") {
                let athenaMessage = message as AthenaMessage;
                switch (athenaMessage.customType) {
                  case "chat_message":
                    llmMessages.push({
                      role: "user",
                      content: `${athenaMessage.details.senderName || athenaMessage.details.senderId} said: ${athenaMessage.content}`,
                      timestamp: message.timestamp,
                    });
                    break;
                  case "group_notice":
                    llmMessages.push({
                      role: "user",
                      content: athenaMessage.content,
                      timestamp: message.timestamp,
                    });
                    break;
                  default:
                    llmMessages.push(message);
                    break;
                }
              } else {
                llmMessages.push(message);
              }
            }
            return convertToLlm(llmMessages);
          },
        });
        const platform = session.platform;
        const channelId = session.channelId!;
        const agentSession = new AgentSession({
          cwd: this.config.basePath,
          agent,
          sessionManager,
          extensions: this.extensionRegistry.getAll(),
          customSystemPrompt: `你现在正在${platform}的频道${channelId}中与用户进行对话。请根据用户的输入生成回复，并在需要时调用工具。`,
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
