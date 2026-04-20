import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { Bot, Context, Service, Session } from "koishi";

import { resolveSenderIdentity, summarizeReplyContent } from "./channel-message";
import { projectToAthenaMessage } from "./domain/project-to-athena-message";
import { Activation, type ActivationResult, type AthenaEvent, type ChannelScopedAthenaEvent, type EventBatch } from "./types";
import { InstructionStateService } from "./instruction-state/service";
import { ChannelRuntime } from "./runtime";
import { SessionManager } from "./session-manager";
import {
  SettingsManager,
  type AthenaSessionSettings,
  type SettingsConflict,
  type SettingsIssue,
  type SettingsReloadMetadata,
} from "./settings-manager";
import type { ChannelMessageInput, ChannelKey } from "./types/index";
import { evaluateActivationPolicy } from "./willingness";

type RuntimeStateInput = ChannelScopedAthenaEvent;

export interface ChannelSettingsReloadResult {
  channelKey: ChannelKey;
  status: "reloaded" | "failed";
  summary: string;
  metadata?: SettingsReloadMetadata;
  error?: string;
}

export interface ReloadAllChannelSettingsResult {
  count: number;
  results: ChannelSettingsReloadResult[];
  summary: string;
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
    prompts: {
      builtInInstructions: config.instructions,
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
  streaming?: boolean;
  maxSteps?: number;
  /** Base response timeout in ms. Default 60000. */
  baseTimeoutMs?: number;
  /** Additional timeout per step in ms. Default 30000. */
  perStepTimeoutMs?: number;
  /** Chunk timeout in ms. Default 10000. */
  chunkTimeoutMs?: number;
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
 * 1. Koishi message event → koishiSessionToAthenaEvent()
 * 2. AgentSessionService.ingestEvent() → persist raw event, form eventBatch, evaluate activation
 * 3. Persist hidden activation_result, then wake ChannelRuntime only for activated batches
 */
export class AgentSessionService extends Service<AgentSessionServiceConfig> {
  static inject = ["yesimbot.model", "yesimbot.plugin"];

  private agents: Map<ChannelKey, ChannelRuntime> = new Map();
  private pendingAgentCreations: Map<ChannelKey, Promise<ChannelRuntime>> = new Map();
  private pendingEventBatches: Map<ChannelKey, EventBatch> = new Map();
  /** TTL-based dedupe set for messageIds. Map<messageId, expiryTimestamp>. */
  private recentMessageIds: Map<string, number> = new Map();
  private readonly dedupeTtlMs = 120000;
  private readonly instructionStateService: InstructionStateService;

  constructor(ctx: Context, config: AgentSessionServiceConfig) {
    super(ctx, "yesimbot.session", false);
    this.config = config;
    this.logger = ctx.logger("yesimbot.session");
    this.logger.level = config.logLevel ?? 2;
    this.instructionStateService = new InstructionStateService(
      join(this.ctx.baseDir, this.config.basePath),
    );
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  protected async start(): Promise<void> {
    this.ctx.middleware(async (session, next) => {
      const event = koishiSessionToAthenaEvent(session);
      if (event) {
        this.ingestEvent(event, session.bot).catch((err) => {
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
    this.pendingAgentCreations.clear();
    this.pendingEventBatches.clear();
    this.recentMessageIds.clear();
    this.logger.info("AgentSessionService stopped");
  }

  // =========================================================================
  // Event Routing
  // =========================================================================

  /** Compatibility adapter for message-shaped ingress. */
  async receive(input: ChannelMessageInput, bot?: Bot): Promise<void> {
    return this.ingestEvent(channelMessageToAthenaEvent(input), bot);
  }

  /** Primary Phase 11 ingress seam. */
  async ingestEvent(event: AthenaEvent, bot?: Bot): Promise<void> {
    if (!isChannelScopedEvent(event)) {
      throw new Error(`AgentSessionService.ingestEvent() requires a channel-scoped event`);
    }

    const routeBot = bot;

    const selfId = routeBot?.selfId ?? "";
    if (event.kind === "message" && selfId && event.sender.userId === selfId) {
      return;
    }

    if (event.kind === "message" && this.isDuplicate(event.messageId)) {
      this.logger.debug(`Duplicate message ${event.messageId} dropped`);
      return;
    }

    this.recordInstructionState(event);
    const agent = await this.getOrCreateAgent(event, routeBot);
    agent.session.appendAthenaMessage(projectToAthenaMessage(event));

    const batch = this.appendEventToBatch(event);
    const activation = await this.evaluateActivation(agent, batch, routeBot);

    agent.session.appendActivationResult({
      id: `${batch.batchId}:activation:${event.id}`,
      timestamp: event.timestamp,
      stage: "ingress",
      batchId: batch.batchId,
      activated: activation.activated,
      reasons: activation.reasons,
    });

    if (!activation.activated) {
      return;
    }

    try {
      await agent.wake({
        ...batch,
        events: [...batch.events],
        activation,
      });
    } finally {
      this.pendingEventBatches.delete(batch.channelKey);
    }
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
  private async getOrCreateAgent(
    input: ChannelScopedAthenaEvent,
    bot?: Bot,
  ): Promise<ChannelRuntime> {
    const { platform, channelId } = input;
    const channelKey: ChannelKey = `${platform}:${channelId}`;
    const existing = this.agents.get(channelKey);
    if (existing) {
      existing.bindBot(bot);
      return existing;
    }

    const pending = this.pendingAgentCreations.get(channelKey);
    if (pending) {
      const agent = await pending;
      agent.bindBot(bot);
      return agent;
    }

    const creationPromise = this.createAndStoreAgent(channelKey, input, bot).finally(() => {
      this.pendingAgentCreations.delete(channelKey);
    });
    this.pendingAgentCreations.set(channelKey, creationPromise);

    return creationPromise;
  }

  private async createAndStoreAgent(
    channelKey: ChannelKey,
    input: ChannelScopedAthenaEvent,
    bot?: Bot,
  ): Promise<ChannelRuntime> {
    const { platform, channelId } = input;
    const globalSettingsPath = this.getGlobalSettingsPath();
    const basePath = this.getRuntimeStateDir(input);
    const sessionDir = join(basePath, "session");
    const channelSettingsPath = this.getRuntimeSettingsPath(input);

    this.instructionStateService.ensureGlobalState();
    this.ensureRuntimeState(input);
    mkdirSync(sessionDir, { recursive: true });

    const settingsManager = new SettingsManager({
      globalSettingsPath,
      channelSettingsPath,
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

    const agent = new ChannelRuntime(this.ctx, {
      bot,
      sessionManager,
      settingsManager,
      instructionStateService: this.instructionStateService,
      instructions: this.collectInstructions(channelKey),
      platform,
      channelId,
      basePath,
    });

    this.agents.set(channelKey, agent);
    return agent;
  }

  private collectInstructions(channelKey: ChannelKey) {
    const pluginService = this.ctx["yesimbot.plugin"];
    return (pluginService?.getInstructions?.(channelKey) as never) ?? [];
  }

  private getRuntimeStateDir(
    input: RuntimeStateInput,
  ): string {
    if (input.kind === "message" && input.isDirect) {
      return this.instructionStateService.getUserStateDir(input.platform, input.sender.userId);
    }

    return this.instructionStateService.getChannelStateDir(input.platform, input.channelId);
  }

  private ensureRuntimeState(
    input: RuntimeStateInput,
  ): void {
    if (input.kind === "message" && input.isDirect) {
      this.instructionStateService.ensureUserState(input.platform, input.sender.userId);
      return;
    }

    this.instructionStateService.ensureChannelState(input.platform, input.channelId);
  }

  private getRuntimeSettingsPath(
    input: RuntimeStateInput,
  ): string {
    return join(this.getRuntimeStateDir(input), "settings.json");
  }

  private getGlobalRoot(): string {
    return join(this.ctx.baseDir, this.config.basePath);
  }

  private getGlobalSettingsPath(): string {
    return join(this.getGlobalRoot(), "settings.json");
  }

  async reloadChannelSettings(
    platform: string,
    channelId: string,
    _bot?: Bot,
  ): Promise<ChannelSettingsReloadResult> {
    const channelKey: ChannelKey = `${platform}:${channelId}`;

    const agent = this.agents.get(channelKey);
    if (!agent) {
      return {
        channelKey,
        status: "failed",
        summary: `No active agent for ${channelKey}.`,
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

    const channelSource = this.describeSettingsSource(
      "channel",
      metadata.sources.channel.exists,
      metadata.sources.channel.valid,
    );
    const globalSource = this.describeSettingsSource(
      "global",
      metadata.sources.global.exists,
      metadata.sources.global.valid,
    );
    const issueSummary = metadata.issues.length > 0 ? `; issues=${metadata.issues.length}` : "";
    const conflictSummary =
      metadata.conflicts.length > 0 ? `; overrides=${metadata.conflicts.length}` : "";

    return `${channelKey}: precedence ${precedence}; ${channelSource}; ${globalSource}${issueSummary}${conflictSummary}`;
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

  private recordInstructionState(input: ChannelScopedAthenaEvent): void {
    this.instructionStateService.ensureGlobalState();
    if (input.kind !== "message" || !input.isDirect) {
      this.instructionStateService.ensureChannelState(input.platform, input.channelId);
      this.instructionStateService.writeChannelMeta({
        platform: input.platform,
        channelId: input.channelId,
        channelName: undefined,
        kind: "group",
      });
      return;
    }

    this.instructionStateService.ensureUserState(input.platform, input.sender.userId);
    this.instructionStateService.writeUserMeta({
      platform: input.platform,
      userId: input.sender.userId,
      username: input.sender.username,
      displayName: input.sender.nickname ?? input.sender.username,
      kind: "private-user",
    });
  }

  private appendEventToBatch(event: ChannelScopedAthenaEvent): EventBatch {
    const channelKey: ChannelKey = `${event.platform}:${event.channelId}`;
    const pending = this.pendingEventBatches.get(channelKey);
    if (!pending) {
      const nextBatch: EventBatch = {
        batchId: `batch:${event.id}`,
        channelKey,
        events: [event],
      };
      this.pendingEventBatches.set(channelKey, nextBatch);
      return nextBatch;
    }

    pending.events.push(event);
    return pending;
  }

  private async evaluateActivation(
    agent: ChannelRuntime,
    batch: EventBatch,
    bot?: Bot,
  ): Promise<ActivationResult> {
    const activation = Activation.evaluate(batch);
    const latestMessage = findLatestMessageEvent(batch.events);
    if (!latestMessage) {
      return activation;
    }

    const existingPolicyIndex = findLatestPolicyReasonIndex(activation);
    const judgeSettings = agent.getSettingsManager().getJudgeSettings();
    const policy = await evaluateActivationPolicy(
      agent.getWillingnessJudge(),
      {
        isDirect: latestMessage.isDirect,
        atSelf: latestMessage.atSelf,
        isReplyToBot: latestMessage.isReplyToBot,
        content: latestMessage.content,
        selfId: bot?.selfId ?? "",
        senderId: latestMessage.sender.userId,
        judgeEnabled: judgeSettings?.enabled,
        judgeModel: judgeSettings?.model,
        judgeTimeoutMs: judgeSettings?.timeoutMs,
      },
    );

    if (existingPolicyIndex >= 0) {
      activation.reasons[existingPolicyIndex] = { source: "policy", code: policy.reason };
    } else {
      activation.reasons.push({ source: "policy", code: policy.reason });
    }
    activation.activated = activation.reasons.some((reason) =>
      reason.code === "direct_message" ||
      reason.code === "at_self" ||
      reason.code === "llm_judge" ||
      reason.code === "platform_notice" ||
      reason.code === "internal_signal",
    );
    return activation;
  }

  /** List all active channel keys. */
  getActiveChannels(): ChannelKey[] {
    return [...this.agents.keys()];
  }
}

// ============================================================================
// Event helpers
// ============================================================================

function isChannelScopedEvent(event: AthenaEvent): event is ChannelScopedAthenaEvent {
  return "channelId" in event && typeof event.channelId === "string";
}

function channelMessageToAthenaEvent(
  input: ChannelMessageInput,
): Extract<AthenaEvent, { kind: "message" }> {
  return {
    kind: "message",
    id: input.messageId || `${input.platform}:${input.channelId}:${input.timestamp}`,
    timestamp: input.timestamp,
    platform: input.platform,
    channelId: input.channelId,
    messageId: input.messageId,
    content: input.content,
    sender: input.sender,
    isDirect: input.isDirect,
    atSelf: input.atSelf,
    isReplyToBot: input.isReplyToBot,
    replyTo: input.replyTo,
    raw: input.raw,
  };
}

function findLatestMessageEvent(events: AthenaEvent[]): Extract<AthenaEvent, { kind: "message" }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind === "message") {
      return event;
    }
  }

  return null;
}

function findLatestPolicyReasonIndex(result: ActivationResult): number {
  for (let i = result.reasons.length - 1; i >= 0; i--) {
    if (result.reasons[i]?.source === "policy") {
      return i;
    }
  }

  return -1;
}

// Koishi Session → channel input mapping
// ============================================================================

/**
 * Convert a Koishi session object to channel input.
 * Returns null if the session lacks required fields.
 */
export function koishiSessionToChannelInput(session: Session): ChannelMessageInput | null {
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
    kind: "channel_message",
    platform: session.platform,
    channelId: session.channelId,
    messageId: session.messageId ?? "",
    timestamp: session.timestamp ?? Date.now(),
    content,
    sender: {
      userId: session.userId,
      username: session.username ?? session.userId,
      nickname,
      identity,
    },
    isDirect: session.isDirect ?? false,
    atSelf,
    isReplyToBot: (session.quote && session.quote.user?.isBot) || false,
    replyTo,
  } satisfies ChannelMessageInput;
}

export function koishiSessionToAthenaEvent(
  session: Session,
): Extract<AthenaEvent, { kind: "message" }> | null {
  const input = koishiSessionToChannelInput(session);
  if (!input) {
    return null;
  }

  return channelMessageToAthenaEvent(input);
}
