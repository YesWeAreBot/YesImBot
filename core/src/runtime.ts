import { join, resolve } from "node:path";

import type {} from "@yesimbot/agent";
import { Agent } from "@yesimbot/agent/agent";
import { ChatModelRef } from "@yesimbot/agent/ai";
import {
  AgentSession,
  BuildSystemPromptOptions,
  convertToLlm,
  ExtensionDefinition,
  SessionManager,
  SettingsManager,
} from "@yesimbot/agent/session";
import { Bot, Context, Logger, Service } from "koishi";

import type { AthenaEvent, ChatMessageDetails } from "./adapter/types.js";
import type { ChannelContext } from "./extension.js";
import { createChatHistoryExtension } from "./extension/chat-history/index.js";

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
  static inject = ["yesimbot.model", "yesimbot.extension", "yesimbot.session", "yesimbot.adapter"];
  readonly logger: Logger;

  /** Active sessions map — promoted to class property for debug command access */
  private _channels = new Map<ChannelKey, SessionContext>();
  private _globalSettingsManager?: SettingsManager;

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
    const globalSettingsPath = join(this.config.basePath, "settings.json");

    let chatModel: ChatModelRef;
    try {
      chatModel = this.ctx["yesimbot.model"].resolveChatModel(this.config.chatModel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ctx.logger.error(`Failed to resolve chat model: ${this.config.chatModel} (${message})`);
      return;
    }

    this._globalSettingsManager = new SettingsManager({
      globalPath: globalSettingsPath,
    });

    const createSessionContext = (
      context: ChannelContext,
      sessionManager: SessionManager,
      bot: Bot,
    ): SessionContext => {
      const { platform, channelId, type } = context;
      const agent = new Agent({
        model: chatModel.model,
        convertToLlm: (messages) => convertToLlm(messages),
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

      // Create SettingsManager for dual-scope settings
      const channelDir = this.ctx["yesimbot.session"].getChannelDir(platform, channelId);
      const settingsManager = new SettingsManager({
        globalPath: globalSettingsPath,
        localPath: join(channelDir, "settings.json"),
      });

      const agentSession = new AgentSession({
        cwd: this.config.basePath,
        agent,
        sessionManager,
        settingsManager,
        extensions: [
          ...this.ctx["yesimbot.extension"].getAllExtensions(context),
          promptExtension,
          createChatHistoryExtension(
            this.ctx,
            {
              sessionsDir: resolve(this.config.basePath, "sessions"),
              isolation: false,
              defaultLimit: 10,
              maxLimit: 30,
            },
            context,
          ),
        ],
      });
      this.ctx["yesimbot.extension"].registerRunner(agentSession.extensionRunner, context);

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
              // const reasoningContent = event.message.content
              //   .filter((part) => part.type === "reasoning")
              //   .map((part) => part.text)
              //   .join("");

              // if (reasoningContent) {
              //   this.logger.info(`Agent reasoning:\n${reasoningContent}`);
              //   if (sessionContext.type !== "private") {
              //     sessionContext.bot.sendMessage(
              //       sessionContext.channelId,
              //       `[Reasoning]\n${reasoningContent}`,
              //     );
              //   }
              // }
              if (textContent) {
                this.logger.info(`Agent response:\n${textContent}`);
                sessionContext.bot.sendMessage(sessionContext.channelId, textContent);
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
        this.ctx["yesimbot.extension"].unregisterRunner(existing.agentSession.extensionRunner);
        existing.agentSession.dispose();
        const newCtx = createSessionContext(
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

        const bot = event.meta.bot;
        if (!bot) {
          this.logger.warn(`No bot reference available for channel ${key}, skipping`);
          return;
        }

        const sessionContext = createSessionContext(
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

      const shouldTriggerTurn = channelAllowed && event.meta.triggerCandidate;

      // Format for LLM
      const formatted = await this.ctx["yesimbot.adapter"].formatters.format(event, {
        conversationType: event.source.conversationType,
        selfId: sessionContext.bot.selfId,
      });

      if (formatted === null) return;

      if (!event.meta.persist && !shouldTriggerTurn) return;

      const options = shouldTriggerTurn
        ? { triggerTurn: true, deliverAs: "followUp" as const }
        : { triggerTurn: false };

      await sessionContext.agentSession.sendCustomMessage(
        {
          customType: "athena:message",
          content: formatted,
          display: true,
          details: {
            kind: event.kind,
            platform: event.source.platform,
            channelId: event.source.channelId,
            timestamp: event.timestamp,
            ...(event.kind === "chat_message"
              ? {
                  messageId: (event.details as ChatMessageDetails).messageId,
                  senderId: event.actor.id,
                  senderName: event.actor.name,
                  quoteMessageId: (event.details as ChatMessageDetails).quoteMessageId,
                }
              : {}),
          },
        },
        options,
      );
    });
  }
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
  guidelinesSet.add("发言是行为的一种，沉默、观望、延迟回应同样是正当行为");
  guidelinesSet.add("先判断是否应该介入，再决定如何表达");
  guidelinesSet.add("回复简洁自然，避免冗长解释和过度礼貌");
  guidelinesSet.add("被提及或私聊时优先回应；群聊中观察节奏，不打断对话流");
  const guidelines = Array.from(guidelinesSet)
    .map((g) => `- ${g}`)
    .join("\n");

  const curDate = new Date().toISOString().split("T")[0];

  const envLabel =
    type === "group" ? `群聊: ${platform}:${channelId}` : `私聊: ${platform}:${channelId}`;

  const sceneGuide =
    type === "group"
      ? `你在这个群聊中长期存在。
- 被直接提及时优先回应
- 观察群聊节奏和氛围，不打断正在进行的对话
- 适度参与，不过度发言；沉默和观望是正常行为
- 轻量接话、延迟回应、补充信息都是正当的参与方式`
      : `这是一次私聊对话。
- 用户主动发起对话，通常期望得到回应
- 保持专注，围绕用户当前话题展开
- 回复可以更详细，但仍保持简洁自然
- 如需检索信息或执行操作，优先使用可用工具`;

  return `=== 身份 ===
你是一个长期存在于聊天环境中的成员，不是助手、不是客服、不是问答机器人。
你不以"我能帮你什么"开场，不主动提供未被请求的服务。
你的价值来自持续存在感、节奏感和判断力，而非频繁发言。

=== 当前环境 ===
${envLabel}
日期: ${curDate}

${sceneGuide}

=== 可用工具 ===
${toolsList}

=== 行为准则 ===
${guidelines}
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
