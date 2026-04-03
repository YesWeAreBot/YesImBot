import { join } from "node:path";

import { Bot, Context, Service, Session } from "koishi";

import { ChannelRuntime } from "./runtime";
import { resolveSenderIdentity, summarizeReplyContent } from "./channel-message";
import {
  ensureGlobalScaffold,
  hasExistingWorkspace,
  ensureWorkspaceScaffold,
} from "./scaffold";
import { SessionManager } from "./session-manager";
import {
  SettingsManager,
  type AthenaSessionSettings,
  type SettingsConflict,
  type SettingsIssue,
  type SettingsReloadMetadata,
} from "./settings-manager";
import type {
  ChannelBootstrapResult,
  ChannelBootstrapStatus,
  ChannelEvent,
  ChannelKey,
} from "./types";

interface BootstrappedChannelRuntime {
  channelKey: ChannelKey;
  channelDir: string;
  sessionManager: SessionManager;
  settingsManager: SettingsManager;
  status: Extract<ChannelBootstrapStatus, "restored" | "created">;
}

export interface ChannelSettingsReloadResult {
  channelKey: ChannelKey;
  status: "reloaded" | "missing_workspace" | "failed";
  summary: string;
  metadata?: SettingsReloadMetadata;
  error?: string;
}

export interface ReloadAllChannelSettingsResult {
  count: number;
  results: ChannelSettingsReloadResult[];
  summary: string;
}

function normalizeExternalPath(value?: string | string[]): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Array.isArray(value) ? value : [value];
}

function buildDefaultSettings(config: AgentSessionServiceConfig): AthenaSessionSettings {
  return {
    model: config.model,
    judge: {
      model: config.judgeModel,
      enabled: config.judgeEnabled,
      timeoutMs: config.judgeTimeoutMs,
    },
    compaction: {
      model: config.compactionModel,
      enabled: config.compactionEnabled,
      reserveTokens: config.compactionReserveTokens,
      keepRecentTokens: config.compactionKeepRecentTokens,
      contextWindow: config.contextWindow,
    },
    response: {
      streaming: config.streaming,
      maxSteps: config.maxSteps,
      baseTimeoutMs: config.baseTimeoutMs,
      perStepTimeoutMs: config.perStepTimeoutMs,
      chunkTimeoutMs: config.chunkTimeoutMs,
    },
    workspace: {
      enableWorkspace: config.enableWorkspace,
      enableSandbox: config.enableSandbox,
      enableFilesystem: config.enableFilesystem,
      externalPath: normalizeExternalPath(config.externalPath),
    },
    prompts: {
      builtInInstructions: config.instructions,
      attachedInstructionFiles: config.attachedInstructionFiles,
    },
  };
}

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
  attachedInstructionFiles?: string[];
  streaming?: boolean;
  maxSteps?: number;
  /** Base response timeout in ms. Default 60000. */
  baseTimeoutMs?: number;
  /** Additional timeout per step in ms. Default 30000. */
  perStepTimeoutMs?: number;
  /** Chunk timeout in ms. Default 10000. */
  chunkTimeoutMs?: number;
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
 * Koishi service that manages per-channel AI runtimes.
 *
 * Each channel (platform:channelId) gets its own ChannelRuntime with
 * an isolated SessionManager for JSONL persistence.
 *
 * Message flow:
 * 1. Koishi message event → koishiSessionToChannelEvent()
 * 2. AgentSessionService.receive() → route to ChannelRuntime
 * 3. ChannelRuntime.receive() → persist, willingness check, maybe respond
 */
export class AgentSessionService extends Service<AgentSessionServiceConfig> {
  static inject = ["yesimbot.model", "yesimbot.plugin"];

  private agents: Map<ChannelKey, ChannelRuntime> = new Map();
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

        if (typeof platform !== "string" || typeof channelId !== "string") {
          return "Both --platform and --channel must be specified.";
        }

        const resolvedPlatform = platform;
        const resolvedChannelId = channelId;

        const channelKey: ChannelKey = `${resolvedPlatform}:${resolvedChannelId}`;
        let agent = this.agents.get(channelKey);
        if (!agent) {
          const bootstrap = await this.bootstrapChannelForManagement(
            resolvedPlatform,
            resolvedChannelId,
            session?.bot,
          );
          if (bootstrap.status === "missing_workspace") {
            return `No active agent for ${channelKey}.`;
          }
          if (bootstrap.status === "failed") {
            return `Failed to bootstrap ${channelKey}.`;
          }
          agent = this.agents.get(channelKey);
        }
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

    this.ctx
      .command("agent.reload", "Reload channel settings from override files")
      .option("platform", "-p --platform <platform:string> Platform of the channel")
      .option("channel", "-c --channel <channel:string> Channel ID")
      .option("all", "--all Reload settings for all active agents")
      .action(async ({ session, options }) => {
        if (options?.all) {
          const result = await this.reloadAllChannelSettings();
          return result.summary;
        }

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

        if (typeof platform !== "string" || typeof channelId !== "string") {
          return "Both --platform and --channel must be specified.";
        }

        const result = await this.reloadChannelSettings(platform, channelId, session?.bot);
        return result.summary;
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
  getOrCreateAgent(platform: string, channelId: string, bot?: Bot): ChannelRuntime {
    const channelKey: ChannelKey = `${platform}:${channelId}`;
    const existing = this.agents.get(channelKey);
    if (existing) {
      existing.bindBot(bot);
      return existing;
    }

    const runtime = this.bootstrapChannelRuntime(platform, channelId);
    const agent = this.createChannelRuntime(runtime, bot);

    this.agents.set(channelKey, agent);
    return agent;
  }

  async bootstrapChannelForManagement(
    platform: string,
    channelId: string,
    bot?: Bot,
  ): Promise<ChannelBootstrapResult> {
    const channelKey: ChannelKey = `${platform}:${channelId}`;
    const existing = this.agents.get(channelKey);
    if (existing) {
      existing.bindBot(bot);
      return {
        channelKey,
        status: "ready",
      };
    }

    const channelDir = this.getChannelDir(platform, channelId);
    if (!hasExistingWorkspace(channelDir)) {
      return {
        channelKey,
        status: "missing_workspace",
      };
    }

    try {
      const runtime = this.bootstrapChannelRuntime(platform, channelId);
      const agent = this.createChannelRuntime(runtime, bot);

      this.agents.set(channelKey, agent);
      return {
        channelKey,
        status: runtime.status,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to bootstrap channel ${channelKey} for management:`, error);
      return {
        channelKey,
        status: "failed",
        error: message,
      };
    }
  }

  private bootstrapChannelRuntime(platform: string, channelId: string): BootstrappedChannelRuntime {
    const channelKey: ChannelKey = `${platform}:${channelId}`;

    const globalRoot = this.getGlobalRoot();
    const globalSettingsPath = this.getGlobalSettingsPath();
    const channelDir = this.getChannelDir(platform, channelId);
    const sessionDir = join(channelDir, "session");
    const workspaceSettingsPath = this.getWorkspaceSettingsPath(channelDir);

    ensureGlobalScaffold(globalRoot);
    ensureWorkspaceScaffold(channelDir, globalRoot);

    const settingsManager = new SettingsManager({
      globalSettingsPath,
      workspaceSettingsPath,
      defaults: buildDefaultSettings(this.config),
    });
    this.logReloadMetadata(channelKey, settingsManager.getReloadMetadata());

    const { sessionManager, status } = SessionManager.restoreOrCreateRecent(
      channelKey,
      sessionDir,
      this.config.model,
    );
    if (status === "restored") {
      this.logger.debug(
        `Recovered session for ${channelKey} (${sessionManager.getEntryCount()} entries)`,
      );
    } else {
      this.logger.debug(`Created new session for ${channelKey}`);
    }

    return {
      channelKey,
      channelDir,
      sessionManager,
      settingsManager,
      status,
    };
  }

  private createChannelRuntime(runtime: BootstrappedChannelRuntime, bot?: Bot): ChannelRuntime {
    const { channelDir, channelKey, sessionManager, settingsManager } = runtime;
    const [platform, channelId] = channelKey.split(":") as [string, string];

    return new ChannelRuntime(this.ctx, {
      bot,
      sessionManager,
      settingsManager,
      platform,
      channelId,
      basePath: channelDir,
    });
  }

  private getChannelDir(platform: string, channelId: string): string {
    return join(this.ctx.baseDir, this.config.basePath, `${platform}-${channelId}`);
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

  async reloadChannelSettings(
    platform: string,
    channelId: string,
    bot?: Bot,
  ): Promise<ChannelSettingsReloadResult> {
    const channelKey: ChannelKey = `${platform}:${channelId}`;

    let agent = this.agents.get(channelKey);
    if (!agent) {
      const bootstrap = await this.bootstrapChannelForManagement(platform, channelId, bot);
      if (bootstrap.status === "missing_workspace") {
        return {
          channelKey,
          status: "missing_workspace",
          summary: `No workspace found for ${channelKey}.`,
        };
      }

      if (bootstrap.status === "failed") {
        return {
          channelKey,
          status: "failed",
          error: bootstrap.error,
          summary: `Failed to bootstrap ${channelKey} for settings reload${bootstrap.error ? `: ${bootstrap.error}` : "."}`,
        };
      }

      agent = this.agents.get(channelKey);
    }

    if (!agent) {
      return {
        channelKey,
        status: "failed",
        summary: `Failed to load agent for ${channelKey}.`,
      };
    }

    try {
      const metadata = agent.getSettingsManager().reload();
      this.logReloadMetadata(channelKey, metadata);
      return {
        channelKey,
        status: "reloaded",
        metadata,
        summary: this.formatReloadSummary(channelKey, metadata),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to reload settings for ${channelKey}:`, error);
      return {
        channelKey,
        status: "failed",
        error: message,
        summary: `Failed to reload settings for ${channelKey}: ${message}`,
      };
    }
  }

  async reloadAllChannelSettings(): Promise<ReloadAllChannelSettingsResult> {
    const channelKeys = this.getActiveChannels();
    if (channelKeys.length === 0) {
      return {
        count: 0,
        results: [],
        summary: "No active agents.",
      };
    }

    const results = await Promise.all(
      channelKeys.map(async (channelKey) => {
        const [platform, channelId] = channelKey.split(":") as [string, string];
        return this.reloadChannelSettings(platform, channelId);
      }),
    );

    return {
      count: results.length,
      results,
      summary: `Reloaded settings for ${results.length} active agent(s):\n${results
        .map((result) => `- ${result.summary}`)
        .join("\n")}`,
    };
  }

  private formatReloadSummary(channelKey: ChannelKey, metadata: SettingsReloadMetadata): string {
    const precedence = metadata.precedence
      .map((value) => {
        if (value === "koishi-config") {
          return "Koishi Config";
        }

        return value;
      })
      .join(" > ");

    const workspaceSource = this.describeSettingsSource(
      "workspace",
      metadata.sources.workspace.exists,
      metadata.sources.workspace.valid,
    );
    const globalSource = this.describeSettingsSource(
      "global",
      metadata.sources.global.exists,
      metadata.sources.global.valid,
    );
    const issueSummary =
      metadata.issues.length > 0 ? `; issues=${metadata.issues.length}` : "";
    const conflictSummary =
      metadata.conflicts.length > 0 ? `; overrides=${metadata.conflicts.length}` : "";

    return `${channelKey}: precedence ${precedence}; ${workspaceSource}; ${globalSource}${issueSummary}${conflictSummary}`;
  }

  private describeSettingsSource(label: string, exists: boolean, valid: boolean): string {
    if (!exists) {
      return `${label} settings missing`;
    }

    if (!valid) {
      return `${label} settings invalid`;
    }

    return `${label} settings loaded`;
  }

  private logReloadMetadata(channelKey: ChannelKey, metadata: SettingsReloadMetadata): void {
    if (metadata.conflicts.length > 0) {
      this.logger.warn(this.formatConflictWarning(channelKey, metadata.conflicts));
    }

    if (metadata.issues.length > 0) {
      this.logger.warn(this.formatIssueWarning(channelKey, metadata.issues));
    }
  }

  private formatConflictWarning(channelKey: ChannelKey, conflicts: SettingsConflict[]): string {
    const grouped = conflicts.reduce<Record<string, string[]>>((acc, conflict) => {
      const label = `${conflict.scope}:${conflict.filePath}`;
      acc[label] ??= [];
      acc[label].push(conflict.path);
      return acc;
    }, {});

    const details = Object.entries(grouped)
      .map(([scope, paths]) => `${scope}=[${paths.join(", ")}]`)
      .join("; ");
    return `Manual settings overrides differ from Koishi Config for ${channelKey}: ${details}`;
  }

  private formatIssueWarning(channelKey: ChannelKey, issues: SettingsIssue[]): string {
    const details = issues
      .map((issue) => `${issue.scope}:${issue.path} (${issue.code}, ${issue.filePath})`)
      .join(", ");
    return `Ignored invalid/deprecated settings for ${channelKey}: ${details}`;
  }

  /** Get an existing agent (without creating). */
  getAgent(channelKey: ChannelKey): ChannelRuntime | undefined {
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

  const nickname =
    session.author?.nick ??
    session.author?.user?.nick ??
    session.author?.user?.name ??
    session.username ??
    session.userId;
  const identity = resolveSenderIdentity({
    isDirect: session.isDirect ?? false,
    title: session.author?.title,
    roles: session.author?.roles?.map((role) => role.name ?? "").filter(Boolean),
    isBot: session.author?.user?.isBot ?? false,
  });

  const replyTo = session.quote
    ? {
        messageId: session.quote.id ?? session.quote.messageId,
        userId: session.quote.user?.id ?? session.quote.user?.userId,
        username: session.quote.user?.name ?? session.quote.user?.username ?? "unknown-user",
        nickname:
          session.quote.member?.nick ??
          session.quote.user?.nick ??
          session.quote.user?.nickname ??
          session.quote.user?.name ??
          "unknown-user",
        summary: summarizeReplyContent(session.quote?.content ?? ""),
      }
    : undefined;

  return {
    platform: session.platform,
    channelId: session.channelId,
    userId: session.userId,
    username: session.username ?? session.userId,
    nickname,
    identity,
    replyTo,
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
