import { join } from "node:path";

import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import { Context, Service, type Bot, type Element } from "koishi";

import { buildAgentMessage, formatDirectMessage, formatGroupMessage } from "./format";
import { AthenaResourceLoader } from "./prompt/resource-loader";
import { bindResponseDispatch } from "./response/dispatch";
import type { ChannelContext } from "./tool/tool-types";
import { createChannelTools } from "./tool/tools";
import type {
  ChannelEvent,
  ChannelKey,
  IngressMessage,
  SessionEntry,
  SessionServiceConfig,
  SessionStatus,
} from "./types";
import { judgeWillingness } from "./willingness";

declare module "koishi" {
  interface Context {
    "athena.session": SessionService;
  }
}

export class SessionService extends Service<SessionServiceConfig> {
  static inject = ["athena.models"];

  private readonly entries = new Map<ChannelKey, SessionEntry>();
  private readonly inflight = new Map<ChannelKey, Promise<SessionEntry>>();

  constructor(ctx: Context, config: SessionServiceConfig) {
    super(ctx, "athena.session", false);
    this.config = config;
    this.logger = ctx.logger("athena.session");
    this.logger.level = config.debugLevel ?? 2;
  }

  private buildChannelKey(platform: string, channelId: string): ChannelKey {
    return `${platform}:${channelId}`;
  }

  private buildSessionDir(channelKey: ChannelKey): string {
    return join(this.config.athenaDir, "sessions", channelKey);
  }

  private buildSoulDir(): string {
    return join(this.config.athenaDir, "soul");
  }

  public get(platform: string, channelId: string): AgentSession | undefined {
    const key = this.buildChannelKey(platform, channelId);
    return this.entries.get(key)?.session;
  }

  public getStatus(platform: string, channelId: string): SessionStatus | undefined {
    const key = this.buildChannelKey(platform, channelId);
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    return {
      channelKey: entry.key,
      platform: entry.platform,
      channelId: entry.channelId,
      isStreaming: entry.session.isStreaming,
      hasBot: !!entry.bot,
      sessionDir: entry.sessionDir,
    };
  }

  public getEntry(platform: string, channelId: string): SessionEntry | undefined {
    const key = this.buildChannelKey(platform, channelId);
    return this.entries.get(key);
  }

  public getAllEntries(): SessionEntry[] {
    return Array.from(this.entries.values());
  }

  public async resetSession(platform: string, channelId: string): Promise<boolean> {
    return this.delete(platform, channelId);
  }

  public async switchModel(
    platform: string,
    channelId: string,
    modelRef: string,
  ): Promise<boolean> {
    const entry = this.getEntry(platform, channelId);
    if (!entry) {
      return false;
    }

    const [provider, ...idParts] = modelRef.split(":");
    const modelId = idParts.join(":");
    if (!provider || !modelId) {
      return false;
    }

    const target = this.ctx["athena.models"].modelRegistry
      .getAvailable()
      .find((model) => model.provider === provider && model.id === modelId);

    if (!target) {
      return false;
    }

    try {
      await entry.session.setModel(target);
      entry.modelRef = `${target.provider}:${target.id}`;
      this.logger.info(`Switched model to ${entry.modelRef} for ${entry.key}`);
      return true;
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to switch model for ${entry.key} to ${modelRef}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** Single public receive entry point for incoming channel events. */
  public async receive(event: ChannelEvent): Promise<void> {
    const selfId = event.bot?.selfId ?? "";
    if (selfId && event.userId === selfId) {
      return;
    }

    const willingness = judgeWillingness({
      isDirect: event.isDirect,
      atSelf: event.atSelf,
      isReplyToBot: event.isReplyToBot,
      content: event.content,
      triggerKeywords: this.config.triggerKeywords,
      selfId,
      senderId: event.userId,
    });

    const session = await this.getOrCreate(event.platform, event.channelId, event.bot);

    const quotedContent = this.extractQuotedContent(event.elements);

    const formatted = event.isDirect
      ? formatDirectMessage({ content: event.content, messageId: event.messageId })
      : formatGroupMessage({
          username: event.username,
          content: event.content,
          timestamp: event.timestamp,
          messageId: event.messageId,
          quotedContent,
        });

    const agentMessage = buildAgentMessage(formatted, event.timestamp);

    if (!willingness.shouldRespond) {
      this.persistUserMessage(session, agentMessage);
      this.logger.debug(`appended message from ${event.userId}, reason: ${willingness.reason}`);
      return;
    }

    if (session.isStreaming) {
      await session.sendUserMessage(agentMessage.content, { deliverAs: "followUp" });
    } else {
      await session.sendUserMessage(agentMessage.content);
    }

    this.logger.debug(
      `prompted session for ${event.platform}:${event.channelId}, reason: ${willingness.reason}`,
    );
  }

  private extractQuotedContent(elements: unknown[]): string | undefined {
    for (const element of elements as Element[]) {
      if (element.type !== "quote") {
        continue;
      }

      const attrs = (element.attrs ?? {}) as {
        content?: string;
        text?: string;
      };
      const quoted = attrs.content ?? attrs.text;
      if (quoted && quoted.trim().length > 0) {
        return quoted.trim();
      }
    }

    return undefined;
  }

  private persistUserMessage(session: AgentSession, message: IngressMessage): void {
    session.agent.appendMessage(message);
    session.sessionManager.appendMessage(message);
  }

  private async getOrCreate(platform: string, channelId: string, bot?: Bot): Promise<AgentSession> {
    const key = this.buildChannelKey(platform, channelId);
    const existing = this.entries.get(key);
    if (existing) {
      return existing.session;
    }

    const pending = this.inflight.get(key);
    if (pending) {
      const entry = await pending;
      return entry.session;
    }

    const createPromise = this.createEntry(platform, channelId, bot);
    this.inflight.set(key, createPromise);

    try {
      const entry = await createPromise;
      this.entries.set(key, entry);
      return entry.session;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async createEntry(platform: string, channelId: string, bot?: Bot): Promise<SessionEntry> {
    const channelKey = this.buildChannelKey(platform, channelId);
    const sessionDir = this.buildSessionDir(channelKey);
    const resourceLoader = new AthenaResourceLoader({ soulDir: this.buildSoulDir() });
    const { authStorage, modelRegistry } = this.ctx["athena.models"];
    const projectCwd = join(this.config.athenaDir, "projects");

    const available = modelRegistry.getAvailable();
    const currentModel = available[0];
    const modelRef = currentModel ? `${currentModel.provider}:${currentModel.id}` : "unknown";

    const settings = SettingsManager.create(projectCwd, sessionDir);

    let sessionManager: SessionManager;
    try {
      sessionManager = SessionManager.continueRecent(projectCwd, sessionDir);
    } catch (error: unknown) {
      this.logger.debug(`failed to continue recent session for ${channelKey}: ${String(error)}`);
      sessionManager = SessionManager.create(projectCwd, sessionDir);
    }

    const sendFn = bot
      ? async (content: string) => {
          await bot.sendMessage(channelId, content);
        }
      : async (_content: string) => {
          this.logger.warn(`no bot instance for ${channelKey}, cannot send outbound message`);
        };

    const channelCtx: ChannelContext = {
      sendFn,
      bot,
      platform,
      channelId,
      selfId: bot?.selfId ?? "",
      sessionDir,
    };
    const { customTools } = createChannelTools(channelCtx);

    const { session } = await createAgentSession({
      cwd: projectCwd,
      agentDir: this.config.athenaDir,
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager,
      settingsManager: settings,
      tools: [],
      customTools,
    });

    const injectSystemMessage = (text: string) => {
      session.agent.appendMessage({
        role: "user",
        content: [{ type: "text", text: `[system] ${text}` }],
        timestamp: Date.now(),
      });
    };

    const unsubscribe = bindResponseDispatch(
      session,
      { sendFn, injectSystemMessage, channelKey },
      { maxChars: 1800 },
      { debug: (msg: string) => this.logger.debug(msg) },
    );

    return {
      key: channelKey,
      session,
      sessionDir,
      unsubscribe,
      bot,
      channelId,
      platform,
      modelRef,
    };
  }

  public delete(platform: string, channelId: string): boolean {
    const key = this.buildChannelKey(platform, channelId);
    this.inflight.delete(key);
    const entry = this.entries.get(key);
    if (!entry) {
      return false;
    }

    entry.unsubscribe();
    return this.entries.delete(key);
  }

  async start(): Promise<void> {}

  async dispose(): Promise<void> {
    for (const entry of this.entries.values()) {
      entry.unsubscribe();
    }
    this.entries.clear();
    this.inflight.clear();
  }
}
