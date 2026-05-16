import { join } from "node:path";

import type {} from "@yesimbot/agent";
import { Agent, AgentMessage } from "@yesimbot/agent/agent";
import { ChatModelRef } from "@yesimbot/agent/ai";
import {
  AgentSession,
  BuildSystemPromptOptions,
  convertToLlm,
  ExtensionDefinition,
  SessionManager,
  SettingsManager,
} from "@yesimbot/agent/session";
import type { Settings } from "@yesimbot/agent/session";
import { Bot, Context, Logger, Service } from "koishi";

import type { ChannelContext } from "./extension.js";
import { createSessionContextExtension } from "./extension/session-context/index.js";
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
      logger: this.logger,
    });

    const createSessionContext = (
      context: ChannelContext,
      sessionManager: SessionManager,
      bot: Bot,
    ): SessionContext => {
      const { platform, channelId, type } = context;
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

      // Create SettingsManager for dual-scope settings
      const channelDir = this.ctx["yesimbot.session"].getChannelDir(platform, channelId);
      const settingsManager = new SettingsManager({
        globalPath: globalSettingsPath,
        localPath: join(channelDir, "settings.json"),
        logger: this.logger,
      });

      const agentSession = new AgentSession({
        cwd: this.config.basePath,
        agent,
        sessionManager,
        settingsManager,
        extensions: [
          ...this.ctx["yesimbot.extension"].getAllExtensions(context),
          promptExtension,
          createSessionContextExtension(this.ctx, {
            sessionsDir: this.config.basePath,
            isolation: false,
            defaultLimit: 10,
            maxLimit: 100,
          }),
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

    this.ctx.middleware(async (session, next) => {
      const cid = session.cid as ChannelKey;
      if (!this._channels.has(cid)) {
        const sessionManager = await this.ctx["yesimbot.session"].getOrCreate(
          session.platform!,
          session.channelId!,
          session.isDirect ? "private" : "group",
        );
        const sessionContext = createSessionContext(
          {
            platform: session.platform,
            channelId: session.channelId!,
            type: session.isDirect ? "private" : "group",
          },
          sessionManager,
          session.bot,
        );
        this._channels.set(cid, sessionContext);
        this.logger.info(`Created new agent session for channel ${cid}`);
      }
      const sessionContext = this._channels.get(cid)!;

      const channelAllowed = isChannelAllowed(
        session.platform,
        session.channelId!,
        session.isDirect ? "private" : "group",
        this.config.allowedChannels,
      );

      const isMentioned =
        session.stripped.atSelf ||
        session.elements?.some((el) => el.type === "at" && el.attrs.id === session.bot.selfId);

      const shouldTriggerTurn = channelAllowed && (session.isDirect || isMentioned);

      const options = shouldTriggerTurn
        ? { triggerTurn: true, deliverAs: "followUp" as const }
        : { triggerTurn: false };

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
            senderName: session.author.name,
            quoteMessageId: session.quote?.id,
            quoteMessageContent: session.quote?.content,
            timestamp: Date.now(),
          },
        } as ChatMessage,
        options,
      );

      return next();
    });

    // =========================================================================
    // Debug Commands — for development use only
    // =========================================================================
    this._registerDebugCommands();
  }

  /** Resolve target sessions for debug commands. */
  private _resolveTargetSessions(
    channelKey?: string,
    fallbackChannelKey?: string,
  ): SessionContext[] {
    if (channelKey) {
      const ctx = this._channels.get(channelKey as ChannelKey);
      return ctx ? [ctx] : [];
    }

    if (fallbackChannelKey) {
      const ctx = this._channels.get(fallbackChannelKey as ChannelKey);
      return ctx ? [ctx] : [];
    }

    return Array.from(this._channels.values());
  }

  private _resolveSingleTargetSession(
    channelKey?: string,
    fallbackChannelKey?: string,
  ): SessionContext | undefined {
    const targets = this._resolveTargetSessions(channelKey, fallbackChannelKey);
    if (targets.length === 1) {
      return targets[0];
    }
    return undefined;
  }

  /**
   * Register debug commands under `yesimbot.debug`.
   * Debug command: for development use only — not intended for production.
   */
  private _registerDebugCommands(): void {
    const parent = this.ctx.command("yesimbot.debug", "Debug commands (dev only)", {
      authority: 3,
    });

    const configCommand = parent.subcommand(".config", "Show or update runtime debug config", {
      authority: 3,
    });

    // --- config: view current runtime config (sanitized) ---
    // Debug command: for development use only
    configCommand.action(() => {
      const sanitized = sanitizeDebugValue(this.config);
      return JSON.stringify(sanitized, null, 2);
    });

    // --- config set: modify settings via SettingsManager ---
    // Debug command: for development use only
    configCommand
      .subcommand(".set <key:string> <value:string>", "Modify a setting via SettingsManager", {
        authority: 3,
      })
      .option("scope", "-s, --scope <scope:string>", { fallback: "local" })
      .option("channel", "-c, --channel <channelKey:string>")
      .action(async ({ session, options }, key, value) => {
        if (!key) return "Please provide a setting key.";
        if (value === undefined || value === null) return "Please provide a value.";

        // Forbidden key
        if (key === "extensions") return "Cannot modify 'extensions' via debug command.";

        let scope: "global" | "local";
        try {
          scope = parseDebugScope(options?.scope);
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }

        // Parse and validate the value
        const parsed = parseConfigValue(value);
        const fallbackChannelKey = session?.cid;

        if (scope === "global") {
          const targets = this._resolveTargetSessions(options?.channel, fallbackChannelKey);

          if (targets.length === 0) {
            if (!this._globalSettingsManager) {
              return "Global settings manager is unavailable.";
            }

            try {
              applySetting(this._globalSettingsManager, key, parsed, scope, this.ctx);
              await this._globalSettingsManager.flush();
              return `Set '${key}' = ${JSON.stringify(parsed)} (${scope}) in global settings.`;
            } catch (error) {
              return error instanceof Error ? error.message : String(error);
            }
          }

          const errors: string[] = [];
          for (const sessionCtx of targets) {
            try {
              await applyLiveSetting(sessionCtx.agentSession, key, parsed, scope, this.ctx);
              await sessionCtx.agentSession.settings.flush();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              errors.push(`[${sessionCtx.platform}:${sessionCtx.channelId}] ${message}`);
            }
          }

          if (errors.length > 0) {
            return `Errors:\n${errors.join("\n")}`;
          }

          return `Set '${key}' = ${JSON.stringify(parsed)} (${scope}) on ${targets.length} active session(s).`;
        }

        const target = this._resolveSingleTargetSession(options?.channel, fallbackChannelKey);
        if (!target) {
          return "No active target session found. Use --channel or run the command inside an active session.";
        }

        try {
          await applyLiveSetting(target.agentSession, key, parsed, scope, this.ctx);
          await target.agentSession.settings.flush();
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }

        return `Set '${key}' = ${JSON.stringify(parsed)} (${scope}) for ${target.platform}:${target.channelId}.`;
      });

    const sessionCommand = parent.subcommand(".session", "Inspect or clear active sessions", {
      authority: 3,
    });

    // --- session list ---
    // Debug command: for development use only
    sessionCommand
      .subcommand(".list", "List all active session channel keys", {
        authority: 3,
      })
      .action(() => {
        const keys = Array.from(this._channels.keys());
        if (keys.length === 0) return "No active sessions.";
        return keys.join("\n");
      });

    // --- session info ---
    // Debug command: for development use only
    sessionCommand
      .subcommand(".info <channelKey:string>", "Show session info for a channel", {
        authority: 3,
      })
      .action((_, channelKey) => {
        if (!channelKey) return "Please provide a channel key (e.g. 'onebot:12345').";
        const ctx = this._channels.get(channelKey as ChannelKey);
        if (!ctx) return `No active session for '${channelKey}'.`;
        const usage = ctx.agentSession.getContextUsage();
        return [
          `platform: ${ctx.platform}`,
          `channelId: ${ctx.channelId}`,
          `type: ${ctx.type}`,
          `sessionId: ${ctx.agentSession.sessionId}`,
          `sessionName: ${ctx.agentSession.sessionName ?? "(none)"}`,
          `messages: ${ctx.agentSession.messages.length}`,
          `contextUsage: ${formatDebugTokenUsage(ctx.agentSession, usage)}`,
        ].join("\n");
      });

    // --- session clear ---
    // Debug command: for development use only
    sessionCommand
      .subcommand(
        ".clear <channelKey:string>",
        "Remove a session (auto-rebuilds on next message)",
        {
          authority: 3,
        },
      )
      .action(async (_, channelKey) => {
        if (!channelKey) return "Please provide a channel key.";
        const key = channelKey as ChannelKey;
        const ctx = this._channels.get(key);
        if (!ctx) return `No active session for '${channelKey}'.`;

        this.ctx["yesimbot.extension"].unregisterRunner(ctx.agentSession.extensionRunner);
        ctx.agentSession.dispose();
        this._channels.delete(key);
        await this.ctx["yesimbot.session"].newSession(ctx.platform, ctx.channelId, ctx.type);
        return `Session '${channelKey}' cleared. It will be recreated on next message.`;
      });

    // --- compact ---
    // Debug command: for development use only
    parent
      .subcommand(".compact [channelKey:string]", "Manually trigger context compaction", {
        authority: 3,
      })
      .action(async ({ session }, channelKey) => {
        const target = this._resolveSingleTargetSession(channelKey, session?.cid);
        if (!target) {
          return "No active target session found. Provide channelKey or run inside an active session.";
        }

        const usageBefore = target.agentSession.getContextUsage();
        const tokensBefore = formatDebugTokenUsage(target.agentSession, usageBefore);

        try {
          const result = await target.agentSession.compact();
          const usageAfter = target.agentSession.getContextUsage();
          const tokensAfter = formatDebugTokenUsage(target.agentSession, usageAfter);
          return [
            `Compaction complete for ${target.platform}:${target.channelId}`,
            `tokens before: ${tokensBefore}`,
            `tokens before (compaction input): ${result.tokensBefore}`,
            `tokens after: ${tokensAfter}`,
            `summary length: ${result.summary.length} chars`,
          ].join("\n");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Compaction failed: ${msg}`;
        }
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

// ============================================================================
// Debug Command Helpers — for development use only
// ============================================================================

/** Smart-parse a string value into the appropriate JS type */
function parseConfigValue(value: string): unknown {
  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Number
  if (!isNaN(Number(value)) && !isNaN(parseFloat(value)) && value.trim() !== "") {
    return Number(value);
  }

  // JSON (objects/arrays)
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed;
    }
  } catch {
    // not JSON
  }

  // Plain string
  return value;
}

function parseDebugScope(scope: string | undefined): "global" | "local" {
  if (scope === undefined || scope === "local" || scope === "global") {
    return scope ?? "local";
  }
  throw new Error("scope must be 'global' or 'local'.");
}

function sanitizeDebugValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDebugValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    sanitized[key] = /key|secret|token|password/i.test(key)
      ? "***"
      : sanitizeDebugValue(nestedValue);
  }
  return sanitized;
}

function formatDebugTokenUsage(
  agentSession: AgentSession,
  usage = agentSession.getContextUsage(),
): string {
  if (typeof usage?.tokens === "number") {
    return usage.percent === null || usage.percent === undefined
      ? String(usage.tokens)
      : `${usage.tokens} (${usage.percent.toFixed(1)}%)`;
  }

  return `~${estimateDebugTokens(agentSession.messages)} (estimated)`;
}

function estimateDebugTokens(messages: AgentMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

async function applyLiveSetting(
  agentSession: AgentSession,
  key: string,
  value: unknown,
  scope: "global" | "local",
  ctx: Context,
): Promise<void> {
  switch (key) {
    case "defaultModel": {
      if (typeof value !== "string") throw new Error("defaultModel must be a string.");

      let resolved;
      try {
        resolved = ctx["yesimbot.model"].resolveChatModel(value);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid defaultModel '${value}': ${message}`);
      }

      await agentSession.setModel(resolved.model);
      agentSession.settings.setDefaultModel(value, scope);
      return;
    }
    case "defaultThinkingLevel":
      applySetting(agentSession.settings, key, value, scope, ctx);
      return;
    case "steeringMode":
      if (value !== "all" && value !== "one-at-a-time") {
        throw new Error("steeringMode must be 'all' or 'one-at-a-time'.");
      }
      agentSession.setSteeringMode(value, scope);
      return;
    case "followUpMode":
      if (value !== "all" && value !== "one-at-a-time") {
        throw new Error("followUpMode must be 'all' or 'one-at-a-time'.");
      }
      agentSession.setFollowUpMode(value, scope);
      return;
    case "contextWindow":
      if (typeof value !== "number" || value <= 0) {
        throw new Error("contextWindow must be a positive number.");
      }
      agentSession.setContextWindow(value, scope);
      return;
    case "compaction.enabled":
      if (typeof value !== "boolean") {
        throw new Error("compaction.enabled must be a boolean.");
      }
      agentSession.setAutoCompactionEnabled(value, scope);
      return;
    case "compaction.reserveTokens":
      if (typeof value !== "number" || value <= 0) {
        throw new Error("compaction.reserveTokens must be a positive number.");
      }
      agentSession.setCompactionReserveTokens(value, scope);
      return;
    case "compaction.keepRecentTokens":
      if (typeof value !== "number" || value <= 0) {
        throw new Error("compaction.keepRecentTokens must be a positive number.");
      }
      agentSession.setCompactionKeepRecentTokens(value, scope);
      return;
    case "retry.enabled":
      if (typeof value !== "boolean") {
        throw new Error("retry.enabled must be a boolean.");
      }
      agentSession.setAutoRetryEnabled(value, scope);
      return;
    case "retry.maxRetries":
      if (typeof value !== "number" || value < 0) {
        throw new Error("retry.maxRetries must be a non-negative number.");
      }
      agentSession.setRetryMaxRetries(value, scope);
      return;
    case "retry.baseDelayMs":
      if (typeof value !== "number" || value <= 0) {
        throw new Error("retry.baseDelayMs must be a positive number.");
      }
      agentSession.setRetryBaseDelayMs(value, scope);
      return;
    case "retry.maxDelayMs":
      if (typeof value !== "number" || value <= 0) {
        throw new Error("retry.maxDelayMs must be a positive number.");
      }
      agentSession.setRetryMaxDelayMs(value, scope);
      return;
    default:
      applySetting(agentSession.settings, key, value, scope, ctx);
  }
}

/**
 * Apply a setting key/value to a SettingsManager.
 * Maps dot-path keys (e.g. "compaction.reserveTokens") to the correct setter method.
 * Validates values before applying.
 */
function applySetting(
  settingsManager: SettingsManager,
  key: string,
  value: unknown,
  scope: "global" | "local",
  ctx: Context,
): void {
  switch (key) {
    case "defaultModel": {
      if (typeof value !== "string") throw new Error("defaultModel must be a string.");

      try {
        ctx["yesimbot.model"].resolveChatModel(value);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid defaultModel '${value}': ${message}`);
      }

      settingsManager.setDefaultModel(value, scope);
      break;
    }
    case "defaultThinkingLevel": {
      const valid = ["off", "minimal", "low", "medium", "high", "xhigh"];
      if (typeof value !== "string" || !valid.includes(value)) {
        throw new Error(`defaultThinkingLevel must be one of: ${valid.join(", ")}`);
      }
      settingsManager.setDefaultThinkingLevel(value as Settings["defaultThinkingLevel"], scope);
      break;
    }
    case "steeringMode": {
      if (value !== "all" && value !== "one-at-a-time") {
        throw new Error("steeringMode must be 'all' or 'one-at-a-time'.");
      }
      settingsManager.setSteeringMode(value, scope);
      break;
    }
    case "followUpMode": {
      if (value !== "all" && value !== "one-at-a-time") {
        throw new Error("followUpMode must be 'all' or 'one-at-a-time'.");
      }
      settingsManager.setFollowUpMode(value, scope);
      break;
    }
    case "contextWindow": {
      if (typeof value !== "number" || value <= 0) {
        throw new Error("contextWindow must be a positive number.");
      }
      settingsManager.setContextWindow(value, scope);
      break;
    }
    case "compaction.enabled": {
      if (typeof value !== "boolean") {
        throw new Error("compaction.enabled must be a boolean.");
      }
      settingsManager.setCompactionEnabled(value, scope);
      break;
    }
    case "compaction.reserveTokens": {
      if (typeof value !== "number" || value <= 0) {
        throw new Error("compaction.reserveTokens must be a positive number.");
      }
      settingsManager.setCompactionReserveTokens(value, scope);
      break;
    }
    case "compaction.keepRecentTokens": {
      if (typeof value !== "number" || value <= 0) {
        throw new Error("compaction.keepRecentTokens must be a positive number.");
      }
      settingsManager.setCompactionKeepRecentTokens(value, scope);
      break;
    }
    case "retry.enabled": {
      if (typeof value !== "boolean") {
        throw new Error("retry.enabled must be a boolean.");
      }
      settingsManager.setRetryEnabled(value, scope);
      break;
    }
    case "retry.maxRetries": {
      if (typeof value !== "number" || value < 0) {
        throw new Error("retry.maxRetries must be a non-negative number.");
      }
      settingsManager.setRetryMaxRetries(value, scope);
      break;
    }
    case "retry.baseDelayMs": {
      if (typeof value !== "number" || value <= 0) {
        throw new Error("retry.baseDelayMs must be a positive number.");
      }
      settingsManager.setRetryBaseDelayMs(value, scope);
      break;
    }
    case "retry.maxDelayMs": {
      if (typeof value !== "number" || value <= 0) {
        throw new Error("retry.maxDelayMs must be a positive number.");
      }
      settingsManager.setRetryMaxDelayMs(value, scope);
      break;
    }
    default:
      throw new Error(`Unknown or unsupported setting key: '${key}'`);
  }
}
