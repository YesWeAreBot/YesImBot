import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Bot, Context, Service, Session } from "koishi";

import { ChannelAgent } from "./channel-agent";
import { SessionManager } from "./session-manager";
import { SettingsManager, type AthenaSessionSettings } from "./settings-manager";
import type { ChannelEvent, ChannelKey } from "./types";

// ============================================================================
// Module Augmentation
// ============================================================================

declare module "koishi" {
  interface Context {
    "yesimbot.session": AgentSessionService;
  }
}

// ============================================================================
// Config
// ============================================================================

export interface AgentSessionServiceConfig {
  model: string;
  compactionModel?: string;
  compactionEnabled?: boolean;
  compactionReserveTokens?: number;
  compactionKeepRecentTokens?: number;
  contextWindow?: number;
  judgeModel?: string;
  judgeEnabled?: boolean;
  judgeTimeoutMs?: number;
  basePath: string;
  instructions?: string;
  streaming?: boolean;
  maxSteps?: number;
  /** Base response timeout in ms. Default 60000. */
  baseTimeoutMs?: number;
  /** Additional timeout per step in ms. Default 30000. */
  perStepTimeoutMs?: number;
  /** Chunk timeout in ms. Default 10000. */
  chunkTimeoutMs?: number;
  sendMessageDirectly?: boolean;
  enableWorkspace?: boolean;
  enableSandbox?: boolean;
  enableFilesystem?: boolean;
  externalPath?: string | string[];
  logLevel?: number;
}

// ============================================================================
// AgentSessionService
// ============================================================================

/**
 * Koishi service that manages per-channel AI agents.
 *
 * Each channel (platform:channelId) gets its own ChannelAgent with
 * an isolated SessionManager for JSONL persistence.
 *
 * Message flow:
 * 1. Koishi message event → koishiSessionToChannelEvent()
 * 2. AgentSessionService.receive() → route to ChannelAgent
 * 3. ChannelAgent.receive() → persist, willingness check, maybe respond
 */
export class AgentSessionService extends Service<AgentSessionServiceConfig> {
  static inject = ["yesimbot.model", "yesimbot.plugin"];

  private static readonly DEFAULT_INSTRUCTIONS =
    "你是一个群聊参与者。像真人一样自然地参与对话，不要使用助手腔调。用 <message>内容</message> 标签包裹你要发送的消息。";

  private static readonly DEFAULT_AGENTS_MARKDOWN = `# Workspace Instructions

Add workspace-specific operating rules here.
`;

  private agents: Map<ChannelKey, ChannelAgent> = new Map();
  /** TTL-based dedupe set for messageIds. Map<messageId, expiryTimestamp>. */
  private recentMessageIds: Map<string, number> = new Map();
  private readonly dedupeTtlMs = 120000;

  constructor(ctx: Context, config: AgentSessionServiceConfig) {
    super(ctx, "yesimbot.session", false);
    this.config = config;
    this.logger = ctx.logger("yesimbot.session");
    this.logger.level = config.logLevel ?? 2;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  protected async start(): Promise<void> {
    this.ctx.middleware(async (session, next) => {
      const event = koishiSessionToChannelEvent(session);
      if (event) {
        this.receive(event).catch((err) => {
          this.logger.error(
            `Error handling message for ${event.platform}:${event.channelId}:`,
            err,
          );
        });
      }
      return next();
    });

    this.ctx.command("agent.list", "List active agents").action(() => {
      const channels = this.getActiveChannels();
      if (channels.length === 0) {
        return "No active agents.";
      }
      return `Active agents:\n${channels.map((ch) => `- ${ch}`).join("\n")}`;
    });

    this.ctx
      .command("agent.clear", "Clear agent session for a channel")
      .option("platform", "-p --platform <platform:string> Platform of the channel")
      .option("channel", "-c --channel <channel:string> Channel ID")
      .action(async ({ session, options }) => {
        let platform = options?.platform;
        let channelId = options?.channel;
        if (!platform && !channelId) {
          if (session) {
            platform = session.platform;
            channelId = session.channelId;
          } else {
            return "Please specify a channel with --platform and --channel, or run this command in a channel.";
          }
        } else if (!platform || !channelId) {
          return "Both --platform and --channel must be specified.";
        }

        const channelKey: ChannelKey = `${platform}:${channelId}`;
        const agent = this.agents.get(channelKey);
        if (!agent) {
          return `No active agent for ${channelKey}.`;
        }
        agent.abort();
        this.agents.delete(channelKey);
        return `Cleared agent session for ${channelKey}.`;
      });

    this.ctx
      .command("agent.compact")
      .option("platform", "-p --platform <platform:string> Platform of the channel")
      .option("channel", "-c --channel <channel:string> Channel ID")
      .option("context", "--context <tokens:number> ")
      .action(async ({ session, options }) => {
        let platform = options?.platform;
        let channelId = options?.channel;
        if (!platform && !channelId) {
          if (session) {
            platform = session.platform;
            channelId = session.channelId;
          } else {
            return "Please specify a channel with --platform and --channel, or run this command in a channel.";
          }
        } else if (!platform || !channelId) {
          return "Both --platform and --channel must be specified.";
        }

        const channelKey: ChannelKey = `${platform}:${channelId}`;
        const agent = this.agents.get(channelKey);
        if (!agent) {
          return `No active agent for ${channelKey}.`;
        }
        try {
          const contextTokens = options?.context ?? this.config.contextWindow ?? 16384;
          const result = await agent.runCompaction(contextTokens);
          if (!result.compacted) {
            if (result.reason === "empty-session") {
              return `No compaction needed for ${channelKey}: session is empty.`;
            }

            if (result.reason === "already-compacted") {
              return `No compaction needed for ${channelKey}: latest entry is already a compaction.`;
            }

            return `No compaction needed for ${channelKey}: nothing eligible to compact.`;
          }

          return `Compaction completed for ${channelKey}.`;
        } catch (err) {
          this.logger.error(`Error running compaction for ${channelKey}:`, err);
          return `Failed to run compaction for ${channelKey}.`;
        }
      });

    this.logger.info("AgentSessionService started");
  }

  protected async stop(): Promise<void> {
    // Abort all active agents
    for (const [key, agent] of this.agents) {
      agent.abort();
      this.logger.debug(`Aborted agent for ${key}`);
    }
    this.agents.clear();
    this.recentMessageIds.clear();
    this.logger.info("AgentSessionService stopped");
  }

  // =========================================================================
  // Message Routing
  // =========================================================================

  /** Process an incoming channel event. */
  async receive(event: ChannelEvent): Promise<void> {
    // Ignore self-messages
    const selfId = event.bot?.selfId ?? "";
    if (selfId && event.userId === selfId) {
      return;
    }

    if (this.isDuplicate(event.messageId)) {
      this.logger.debug(`Duplicate message ${event.messageId} dropped`);
      return;
    }

    const agent = this.getOrCreateAgent(event.platform, event.channelId, event.bot);
    await agent.receive(event);
  }

  private isDuplicate(messageId: string): boolean {
    if (!messageId) {
      return false;
    }

    const now = Date.now();
    if (this.recentMessageIds.size > 1000) {
      for (const [id, expiry] of this.recentMessageIds) {
        if (expiry < now) {
          this.recentMessageIds.delete(id);
        }
      }
    }

    const expiry = this.recentMessageIds.get(messageId);
    if (expiry && expiry > now) {
      return true;
    }

    this.recentMessageIds.set(messageId, now + this.dedupeTtlMs);
    return false;
  }

  // =========================================================================
  // Agent Management
  // =========================================================================

  /** Get an existing agent or create a new one for the channel. */
  getOrCreateAgent(platform: string, channelId: string, bot?: Bot): ChannelAgent {
    const channelKey: ChannelKey = `${platform}:${channelId}`;
    const existing = this.agents.get(channelKey);
    if (existing) return existing;

    const channelDir = join(this.ctx.baseDir, this.config.basePath, `${platform}-${channelId}`);
    const sessionDir = join(channelDir, "session");

    this.ensureGlobalScaffold();
    this.ensureWorkspaceScaffold(channelDir);

    const settingsManager = new SettingsManager({
      globalSettingsPath: this.getGlobalSettingsPath(),
      workspaceSettingsPath: this.getWorkspaceSettingsPath(channelDir),
    });
    const resolved = settingsManager.resolveSettings();

    // Try to recover existing session
    let sessionManager = SessionManager.continueRecent(channelKey, sessionDir);
    if (!sessionManager) {
      sessionManager = SessionManager.create(channelKey, sessionDir, this.config.model);
      this.logger.debug(`Created new session for ${channelKey}`);
    } else {
      this.logger.debug(
        `Recovered session for ${channelKey} (${sessionManager.getEntryCount()} entries)`,
      );
    }

    const instructions = async () => await this.buildInstructions(channelDir);

    // Create channel agent
    const agent = new ChannelAgent(this.ctx, {
      bot: bot!,
      sessionManager,
      platform: platform,
      channelId: channelId,
      modelId: resolved.model ?? this.config.model,
      compactionModel: resolved.compaction?.model ?? this.config.compactionModel,
      compactionEnabled: resolved.compaction?.enabled ?? this.config.compactionEnabled,
      compactionReserveTokens:
        resolved.compaction?.reserveTokens ?? this.config.compactionReserveTokens,
      compactionKeepRecentTokens:
        resolved.compaction?.keepRecentTokens ?? this.config.compactionKeepRecentTokens,
      contextWindow: resolved.compaction?.contextWindow ?? this.config.contextWindow,
      judgeModel: resolved.judge?.model ?? this.config.judgeModel,
      judgeEnabled: resolved.judge?.enabled ?? this.config.judgeEnabled,
      judgeTimeoutMs: resolved.judge?.timeoutMs ?? this.config.judgeTimeoutMs,
      basePath: channelDir,
      instructions,
      streaming: resolved.response?.streaming ?? this.config.streaming,
      maxSteps: resolved.response?.maxSteps ?? this.config.maxSteps,
      baseTimeoutMs: resolved.response?.baseTimeoutMs ?? this.config.baseTimeoutMs,
      perStepTimeoutMs: resolved.response?.perStepTimeoutMs ?? this.config.perStepTimeoutMs,
      chunkTimeoutMs: resolved.response?.chunkTimeoutMs ?? this.config.chunkTimeoutMs,
      sendMessageDirectly:
        resolved.response?.sendMessageDirectly ?? this.config.sendMessageDirectly,
      enableWorkspace: resolved.workspace?.enableWorkspace ?? this.config.enableWorkspace,
      enableSandbox: resolved.workspace?.enableSandbox ?? this.config.enableSandbox,
      enableFilesystem: resolved.workspace?.enableFilesystem ?? this.config.enableFilesystem,
      externalPath: resolved.workspace?.externalPath ?? this.config.externalPath,
    });

    this.agents.set(channelKey, agent);
    return agent;
  }

  private getGlobalRoot(): string {
    return join(this.ctx.baseDir, this.config.basePath);
  }

  private getGlobalSettingsPath(): string {
    return join(this.getGlobalRoot(), "settings.json");
  }

  private getWorkspaceSettingsPath(channelDir: string): string {
    return join(channelDir, "settings.json");
  }

  private writeJsonIfMissing(filePath: string, value: unknown): void {
    if (existsSync(filePath)) {
      return;
    }

    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private writeTextIfMissing(filePath: string, content: string): void {
    if (existsSync(filePath)) {
      return;
    }

    writeFileSync(filePath, content, "utf8");
  }

  private copyTextFileIfMissing(sourcePath: string, targetPath: string): void {
    if (existsSync(targetPath) || !existsSync(sourcePath)) {
      return;
    }

    copyFileSync(sourcePath, targetPath);
  }

  private buildDefaultGlobalSettings(): AthenaSessionSettings {
    return {
      model: this.config.model,
      judge: {
        model: this.config.judgeModel,
        enabled: this.config.judgeEnabled,
        timeoutMs: this.config.judgeTimeoutMs,
      },
      compaction: {
        model: this.config.compactionModel,
        enabled: this.config.compactionEnabled,
        reserveTokens: this.config.compactionReserveTokens,
        keepRecentTokens: this.config.compactionKeepRecentTokens,
        contextWindow: this.config.contextWindow,
      },
      response: {
        streaming: this.config.streaming,
        maxSteps: this.config.maxSteps,
        baseTimeoutMs: this.config.baseTimeoutMs,
        perStepTimeoutMs: this.config.perStepTimeoutMs,
        chunkTimeoutMs: this.config.chunkTimeoutMs,
        sendMessageDirectly: this.config.sendMessageDirectly,
      },
      workspace: {
        enableWorkspace: this.config.enableWorkspace,
        enableSandbox: this.config.enableSandbox,
        enableFilesystem: this.config.enableFilesystem,
        externalPath: Array.isArray(this.config.externalPath)
          ? this.config.externalPath
          : this.config.externalPath
            ? [this.config.externalPath]
            : undefined,
      },
      prompts: {
        builtInInstructions: this.config.instructions ?? AgentSessionService.DEFAULT_INSTRUCTIONS,
      },
    };
  }

  private ensureGlobalScaffold(): void {
    const globalRoot = this.getGlobalRoot();
    mkdirSync(globalRoot, { recursive: true });

    this.writeJsonIfMissing(this.getGlobalSettingsPath(), this.buildDefaultGlobalSettings());
    this.writeTextIfMissing(
      join(globalRoot, "SOUL.md"),
      `${AgentSessionService.DEFAULT_INSTRUCTIONS}\n`,
    );
    this.writeTextIfMissing(
      join(globalRoot, "AGENTS.md"),
      AgentSessionService.DEFAULT_AGENTS_MARKDOWN,
    );
  }

  private ensureWorkspaceScaffold(channelDir: string): void {
    const workspaceDir = join(channelDir, "workspace");
    mkdirSync(workspaceDir, { recursive: true });

    this.writeJsonIfMissing(this.getWorkspaceSettingsPath(channelDir), { useGlobal: true });

    const globalRoot = this.getGlobalRoot();
    this.copyTextFileIfMissing(join(globalRoot, "SOUL.md"), join(workspaceDir, "SOUL.md"));
    this.copyTextFileIfMissing(join(globalRoot, "AGENTS.md"), join(workspaceDir, "AGENTS.md"));
  }

  private buildInstructions(channelDir: string): string {
    const settingsManager = new SettingsManager({
      globalSettingsPath: this.getGlobalSettingsPath(),
      workspaceSettingsPath: this.getWorkspaceSettingsPath(channelDir),
    });
    const resolved = settingsManager.resolveSettings();

    const builtIn =
      resolved.prompts?.builtInInstructions ??
      this.config.instructions ??
      AgentSessionService.DEFAULT_INSTRUCTIONS;

    const workspaceDir = join(channelDir, "workspace");

    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true });
    }

    const extras: string[] = [];

    for (const filename of ["SOUL.md", "AGENTS.md"]) {
      const filePath = join(workspaceDir, filename);
      if (!existsSync(filePath)) {
        continue;
      }

      try {
        const content = readFileSync(filePath, "utf8").trim();
        if (content) {
          extras.push(content);
        }
      } catch {
        this.logger.warn(`Failed to read instructions from ${filePath}`);
      }
    }

    if (extras.length === 0) {
      return builtIn;
    }

    return `${builtIn}\n\n${extras.join("\n\n")}`;
  }

  /** Get an existing agent (without creating). */
  getAgent(channelKey: ChannelKey): ChannelAgent | undefined {
    return this.agents.get(channelKey);
  }

  /** List all active channel keys. */
  getActiveChannels(): ChannelKey[] {
    return [...this.agents.keys()];
  }
}

// ============================================================================
// Koishi Session → ChannelEvent mapping
// ============================================================================

/**
 * Convert a Koishi session object to our ChannelEvent type.
 * Returns null if the session lacks required fields.
 */
function koishiSessionToChannelEvent(session: Session): ChannelEvent | null {
  if (!session.platform || !session.channelId || !session.userId) {
    return null;
  }

  const selfId = session.bot.selfId;
  const content = session.content ?? "";
  const atSelf =
    session.stripped.atSelf ||
    (session.elements?.find((el) => el.type === "at" && el.attrs.id === selfId) ? true : false);

  return {
    platform: session.platform,
    channelId: session.channelId,
    userId: session.userId,
    username: session.username ?? session.userId,
    content,
    isDirect: session.isDirect ?? false,
    atSelf,
    isReplyToBot: (session.quote && session.quote.user?.isBot) || false,
    messageId: session.messageId ?? "",
    timestamp: session.timestamp ?? Date.now(),
    elements: session.elements ?? [],
    bot: session.bot,
  };
}
