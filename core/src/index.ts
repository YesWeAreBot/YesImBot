import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type {} from "@yesimbot/agent";
import { Agent, AgentMessage } from "@yesimbot/agent/agent";
import type {} from "@yesimbot/agent/ai";
import {
  AgentSession,
  convertToLlm,
  ExtensionDefinition,
  ExtensionRegistry,
  ExtensionRunner,
  SessionManager,
} from "@yesimbot/agent/session";
import { Bot, Context, Logger, Schema, Service } from "koishi";

import { AthenaMessage, ChatMessage } from "./messages";
import { ModelService, ModelServiceConfig } from "./services/model";
import { SessionService } from "./services/session";

interface Config extends ModelServiceConfig {
  chatModel: string;
}

function buildPrompt(
  opts: import("@yesimbot/agent/session").BuildSystemPromptOptions,
  platform: string,
  channelId: string,
): string {
  const { selectedTools, toolSnippets, promptGuidelines } = opts;

  const visibleTools = selectedTools.filter((name) => !!toolSnippets[name]);
  const toolsList =
    visibleTools.length > 0
      ? visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join("\n")
      : "(none)";

  const guidelinesSet = new Set<string>();
  for (const g of promptGuidelines ?? []) {
    const normalized = g.trim();
    if (normalized.length > 0) guidelinesSet.add(normalized);
  }
  guidelinesSet.add("Be concise in your responses");
  guidelinesSet.add("Show file paths clearly when working with files");
  const guidelines = Array.from(guidelinesSet)
    .map((g) => `- ${g}`)
    .join("\n");

  return `你现在正在${platform}的频道${channelId}中与用户进行对话。请根据用户的输入生成回复，并在需要时调用工具。

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}`;
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
  sessionManager: SessionManager;
  platform: string;
  channelId: string;
  bot: Bot;
}

declare module "koishi" {
  export interface Context {
    "yesimbot.extension": ExtensionService;
  }
}

export class ExtensionService extends Service {
  readonly logger: Logger;
  private extensionRegistry: ExtensionRegistry;
  constructor(
    public ctx: Context,
    public config: Config,
  ) {
    super(ctx, "yesimbot.extension");
    this.logger = ctx.logger("yesimbot.extension");
    this.logger.level = config.logLevel ?? 2;

    this.extensionRegistry = new ExtensionRegistry();
  }

  protected async start() {
    this.logger.info("Starting yesimbot extension service");
  }

  public registerExtension(extension: ExtensionDefinition) {
    this.extensionRegistry.add(extension);
  }

  public unregisterExtension(id: string) {
    this.extensionRegistry.remove(id);
  }

  public getExtension(id: string) {
    return this.extensionRegistry.get(id);
  }

  public getAllExtensions() {
    return this.extensionRegistry.getAll();
  }

  public registerRunner(runner: ExtensionRunner) {
    this.extensionRegistry.registerRunner(runner);
  }
}

function convertAthenaMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    if (message.role === "custom" && message.customType === "athena:message") {
      const athenaMessage = message as AthenaMessage;
      switch (athenaMessage.details.kind) {
        case "chat_message":
          return {
            ...message,
            role: "custom" as const,
            rawContent: athenaMessage.content,
            content: `${athenaMessage.details.senderName || athenaMessage.details.senderId} said: ${athenaMessage.content}`,
          };
        case "group_notice":
          return {
            ...message,
            role: "custom" as const,
            rawContent: athenaMessage.content,
            content: athenaMessage.content,
          };
      }
    }
    return message;
  });
}

class RuntimeService extends Service {
  static inject = ["yesimbot.model", "yesimbot.extension", "yesimbot.session"];
  readonly logger: Logger;

  constructor(
    public ctx: Context,
    public config: Config,
  ) {
    super(ctx, "yesimbot.runtime");
    this.logger = ctx.logger("yesimbot.runtime");
    this.logger.level = config.logLevel ?? 2;
  }

  protected async start() {
    this.logger.info("Starting yesimbot runtime service");

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

    const createSessionContext = (
      platform: string,
      channelId: string,
      sessionManager: SessionManager,
      bot: Bot,
    ): SessionContext => {
      const agent = new Agent({
        model: chatModel.model,
        convertToLlm: (messages) => convertToLlm(convertAthenaMessages(messages)),
      });

      const promptExtension: ExtensionDefinition = {
        id: "yesimbot:system-prompt",
        order: -1000,
        setup(api) {
          api.on("agent:before-start", (event) => {
            return {
              systemPrompt: buildPrompt(event.systemPromptOptions, platform, channelId),
            };
          });
        },
      };

      const agentSession = new AgentSession({
        cwd: this.config.basePath,
        agent,
        sessionManager,
        extensions: [...this.ctx["yesimbot.extension"].getAllExtensions(), promptExtension],
      });
      this.ctx["yesimbot.extension"].registerRunner(agentSession.extensionRunner);

      const sessionContext: SessionContext = {
        agentSession,
        sessionManager,
        platform,
        channelId,
        bot,
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

      return sessionContext;
    };

    this.ctx.on("session:new", async ({ platform, channelId, sessionManager }) => {
      const key: ChannelKey = `${platform}:${channelId}`;
      const existing = channels.get(key);
      if (existing) {
        existing.agentSession.dispose();
        const newCtx = createSessionContext(platform, channelId, sessionManager, existing.bot);
        channels.set(key, newCtx);
        this.logger.info(`Session replaced for channel ${key}`);
      }
    });

    this.ctx.middleware(async (session, next) => {
      const cid = session.cid as ChannelKey;
      if (!channels.has(cid)) {
        const sessionManager = await this.ctx["yesimbot.session"].getOrCreate(
          session.platform!,
          session.channelId!,
        );
        const sessionContext = createSessionContext(
          session.platform,
          session.channelId!,
          sessionManager,
          session.bot,
        );
        channels.set(cid, sessionContext);
        this.logger.info(`Created new agent session for channel ${cid}`);
      }
      const sessionContext = channels.get(cid)!;

      await sessionContext.agentSession.sendCustomMessage(
        {
          customType: "athena:message",
          content: String(session.content),
          display: true,
          details: {
            kind: "chat_message",
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
  ctx.plugin(ExtensionService, config);
  ctx.plugin(SessionService, config);
  ctx.plugin(RuntimeService, config);
}
