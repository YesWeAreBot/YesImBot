import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Bot, Context, Service, Session } from "koishi";

import { ChannelAgent } from "./channel-agent";
import { SessionManager } from "./session-manager";
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
  basePath: string;
  instructions?: string;
  maxSteps?: number;
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
  static inject = ["yesimbot.model"];

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
    // Register message listener
    this.ctx.on("message", (session: Session) => {
      const event = koishiSessionToChannelEvent(session);
      if (event) {
        this.receive(event).catch((err) => {
          this.logger.error(
            `Error handling message for ${event.platform}:${event.channelId}:`,
            err,
          );
        });
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

    const instructions = this.buildInstructions(channelDir);

    // Create channel agent
    const agent = new ChannelAgent(this.ctx, {
      bot: bot!,
      sessionManager,
      platform: platform,
      channelId: channelId,
      modelId: this.config.model,
      basePath: channelDir,
      instructions,
      maxSteps: this.config.maxSteps,
      responseTimeoutMs: 60000,
      chunkTimeoutMs: 10000,
    });

    this.agents.set(channelKey, agent);
    return agent;
  }

  private buildInstructions(channelDir: string): string {
    const builtIn =
      this.config.instructions ??
      "你是一个群聊参与者。像真人一样自然地参与对话，不要使用助手腔调。用 <message>内容</message> 标签包裹你要发送的消息。";

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
        this.ctx.logger.warn(`Failed to read instructions from ${filePath}`);
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
