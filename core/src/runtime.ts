import type {} from "@yesimbot/agent";
import { Agent, AgentMessage } from "@yesimbot/agent/agent";
import {
  AgentSession,
  BuildSystemPromptOptions,
  convertToLlm,
  ExtensionDefinition,
  SessionManager,
} from "@yesimbot/agent/session";
import { Bot, Context, Logger, Service } from "koishi";

import { AthenaMessage, ChatMessage } from "./messages.js";

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
}

export interface RuntimeConfig {
  basePath: string;
  chatModel: string;
  allowedChannels: ChannelIdentifier[];
  logLevel?: number;
}

export class RuntimeService extends Service<RuntimeConfig> {
  static inject = ["yesimbot.model", "yesimbot.extension", "yesimbot.session"];
  readonly logger: Logger;

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
      type: "private" | "group",
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
              systemPrompt: buildPrompt(event.systemPromptOptions, platform, channelId, type),
            };
          });
        },
      };

      const agentSession = new AgentSession({
        cwd: this.config.basePath,
        agent,
        sessionManager,
        contextWindow: 65536,
        extensions: [...this.ctx["yesimbot.extension"].getAllExtensions(), promptExtension],
      });
      agentSession.sessionName = `${platform}:${channelId}`;
      this.ctx["yesimbot.extension"].registerRunner(agentSession.extensionRunner);

      const sessionContext: SessionContext = {
        agentSession,
        sessionManager,
        platform,
        channelId,
        type,
        bot,
      };

      agentSession.subscribe((event) => {
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
                if (sessionContext.type !== "private") {
                  sessionContext.bot.sendMessage(
                    sessionContext.channelId,
                    `[Reasoning]\n${reasoningContent}`,
                  );
                }
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
        this.ctx["yesimbot.extension"].unregisterRunner(existing.agentSession.extensionRunner);
        existing.agentSession.dispose();
        const newCtx = createSessionContext(
          platform,
          channelId,
          existing.type,
          sessionManager,
          existing.bot,
        );
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
          session.isDirect ? "private" : "group",
        );
        const sessionContext = createSessionContext(
          session.platform,
          session.channelId!,
          session.isDirect ? "private" : "group",
          sessionManager,
          session.bot,
        );
        channels.set(cid, sessionContext);
        this.logger.info(`Created new agent session for channel ${cid}`);
      }
      const sessionContext = channels.get(cid)!;

      const channelAllowed = isChannelAllowed(
        session.platform!,
        session.channelId!,
        session.isDirect ? "private" : "group",
        this.config.allowedChannels,
      );

      const isMentioned = session.stripped.atSelf;

      const shouldTriggerTurn = channelAllowed && (session.isDirect || isMentioned);

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
        { triggerTurn: shouldTriggerTurn, deliverAs: "followUp" },
      );

      return next();
    });
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

function buildPrompt(
  opts: BuildSystemPromptOptions,
  platform: string,
  channelId: string,
  type: "private" | "group",
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
  const guidelines = Array.from(guidelinesSet)
    .map((g) => `- ${g}`)
    .join("\n");

  const curDate = new Date().toLocaleString();
  const curGroupName =
    type === "group" ? `${platform}:${channelId}` : "a private chat" + ` of ${channelId}`;
  return `接下来, 你将不是一个 Assistant, 你要**作为一名某个线上聊天软件内一名成员**, 参与其他人的聊天。

=== 背景 ===

这个群聊的名称是 ${curGroupName}。

当前时间是 ${curDate}。
`;
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
