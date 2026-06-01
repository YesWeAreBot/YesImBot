import { Agent } from "@yesimbot/agent/agent";
import type { ChatModelRef } from "@yesimbot/agent/ai";
import {
  AgentSession,
  convertToLlm,
  HookRunner,
  type SessionManager,
} from "@yesimbot/agent/session";
import type { Bot, Session } from "koishi";

import type { BotInfo } from "../../services/extension/built-in/system-prompt.js";
import type { PlatformEvent } from "../../shared/platform-event.js";
import type { ChannelIdentifier, ChannelKey } from "../../shared/types.js";
import type { ExtensionBindingHost } from "../extension/context.js";
import { createExtensionBinding } from "../extension/context.js";
import { buildToolSnapshotFromBindings } from "../extension/tools.js";
import type {
  Channel,
  ChannelReloadResult,
  ExtensionBinding,
  ExtensionDefinition,
  SpeakElementPromptContext,
} from "../extension/types.js";
import type { PlatformGateway } from "../platform/gateway.js";
import { createSpeakElementRegistry, type SpeakElementRegistry } from "../platform/speak.js";
import { buildAgentSessionConfig } from "./helpers.js";
import { RuntimeSettingsManager, type PartialRuntimeSettings } from "./settings.js";

export interface ChannelSessionDeps {
  channel: Channel;
  sessionManager: SessionManager;
  model: ChatModelRef;
  platformGateway: PlatformGateway;
  settings: {
    globalPath: string;
    localPath: string;
    seed?: PartialRuntimeSettings;
  };
  behavior: {
    allowedChannels: ChannelIdentifier[];
    willingnessManager: {
      shouldReply(event: PlatformEvent, triggerCandidate: boolean): { decision: boolean };
    };
  };
  extensions: {
    definitions: ExtensionDefinition[];
  };
  logger: import("koishi").Logger;
  /** Koishi Bot — 仅在创建时用于 botInfo 和 host 构造，不持久持有 */
  koishiBot: Bot;
}

export class ChannelSession {
  readonly channelKey: ChannelKey;
  readonly channel: Channel;
  readonly sessionManager: SessionManager;
  readonly agentSession: AgentSession;
  readonly hookRunner: HookRunner;
  readonly botInfo: BotInfo;

  private readonly agent: Agent;
  private readonly platformGateway: PlatformGateway;
  readonly koishiBot: Bot;
  readonly botSelfId: string;
  private readonly allowedChannels: ChannelIdentifier[];
  private readonly willingnessManager: ChannelSessionDeps["behavior"]["willingnessManager"];
  private readonly pendingReplyContexts: Array<{ bot: Bot; session?: Session }> = [];
  private readonly unsubscribeOutputBridge: () => void;
  private readonly speakElements: SpeakElementRegistry;
  private bindings: ExtensionBinding[] = [];
  private disposed = false;

  constructor(deps: ChannelSessionDeps) {
    this.channel = deps.channel;
    this.sessionManager = deps.sessionManager;
    this.platformGateway = deps.platformGateway;
    this.koishiBot = deps.koishiBot;
    this.botSelfId = deps.koishiBot.selfId;
    this.channelKey = `${deps.channel.platform}:${deps.channel.channelId}`;
    this.allowedChannels = deps.behavior.allowedChannels;
    this.willingnessManager = deps.behavior.willingnessManager;

    const settingsManager = new RuntimeSettingsManager({
      globalPath: deps.settings.globalPath,
      localPath: deps.settings.localPath,
      seed: deps.settings.seed,
    });
    const merged = settingsManager.settings;

    this.agent = new Agent({
      model: deps.model.model,
      convertToLlm: (messages) => convertToLlm(messages),
    });

    let agentSession!: AgentSession;
    this.hookRunner = new HookRunner(() => ({
      sessionManager: this.sessionManager,
      model: this.agent.state.model,
      isIdle: () => !this.agent.state.isStreaming,
      signal: this.agent.signal,
      abort: () => this.agent.abort(),
      hasPendingMessages: () => this.agent.hasQueuedMessages(),
      getContextUsage: () => agentSession.getContextUsage(),
      compact: (options) => {
        void agentSession
          .compact(options?.customInstructions)
          .then(options?.onComplete)
          .catch(options?.onError);
      },
      getSystemPrompt: () => this.agent.state.systemPrompt,
    }));

    this.agentSession = new AgentSession({
      agent: this.agent,
      sessionManager: this.sessionManager,
      hookRunner: this.hookRunner,
      ...buildAgentSessionConfig(merged),
    });
    agentSession = this.agentSession;

    this.speakElements = createSpeakElementRegistry();

    this.botInfo = {
      selfId: deps.koishiBot.selfId,
      selfName: deps.koishiBot.user?.nick || deps.koishiBot.user?.name || "(unknown)",
    };

    // Output Bridge — 彻底简化
    this.unsubscribeOutputBridge = this.agentSession.subscribe((event) => {
      if (event.type !== "message_end") return;
      if (event.message.role !== "assistant") return;

      const text = event.message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");

      if (!text) return;

      const ctx = this.pendingReplyContexts.shift();
      if (!ctx) return;

      void this.deliverOutput(text, ctx.bot, ctx.session);
    });
  }

  // ========================================================================
  // Ingress: handle PlatformEvent
  // ========================================================================

  async handleEvent(event: PlatformEvent, bot: Bot, originSession?: Session): Promise<void> {
    if (this.disposed) return;

    const channelAllowed = isChannelAllowed(
      event.source.platform,
      event.source.channelId,
      event.source.sourceType === "private" ? "private" : "group",
      this.allowedChannels,
    );

    const { decision } = this.willingnessManager.shouldReply(
      event,
      event.metadata.triggerCandidate,
    );
    const shouldTriggerTurn = channelAllowed && (event.metadata.triggerCandidate || decision);

    if (!event.metadata.persist && !shouldTriggerTurn) return;

    // PlatformEvent 自带 content/visible，不再调 bot.present()
    await this.agentSession.sendCustomMessage(
      {
        customType: "athena:event",
        content: event.content,
        display: event.visible,
        details: event.details,
      },
      shouldTriggerTurn ? { triggerTurn: true, deliverAs: "followUp" } : { triggerTurn: false },
    );

    if (shouldTriggerTurn) {
      this.pendingReplyContexts.push({ bot, session: originSession });
    }
  }

  // ========================================================================
  // Egress: deliver output via gateway
  // ========================================================================

  private async deliverOutput(text: string, bot: Bot, originSession?: Session): Promise<void> {
    const { segments } = await this.speakElements.compile(text, {
      channel: this.channel,
      session: originSession,
    });

    const result = await this.platformGateway.send(bot, this.channel.channelId, segments, {
      originSession,
    });

    if (!result.ok && result.issue) {
      this.sessionManager.appendCustomEntry("athena:delivery_issue", result.issue);
    }
  }

  // ========================================================================
  // Prompt context (unchanged)
  // ========================================================================

  getBotInfo(): BotInfo {
    return this.botInfo;
  }

  getPromptToolContext(): {
    selectedTools: string[];
    toolSnippets: Record<string, string>;
    promptGuidelines: string[];
  } {
    const allTools = new Map<string, { snippet?: string; guidelines?: string[] }>();
    for (const binding of this.bindings) {
      for (const [name, tool] of binding.tools) {
        allTools.set(name, {
          snippet: (tool as { promptSnippet?: string }).promptSnippet,
          guidelines: (tool as { promptGuidelines?: string[] }).promptGuidelines,
        });
      }
    }

    const activeNames = this.agentSession.getActiveToolNames();
    const selectedTools = activeNames.filter((name) => allTools.has(name));
    const toolSnippets: Record<string, string> = {};
    const promptGuidelines: string[] = [];

    for (const name of selectedTools) {
      const tool = allTools.get(name);
      if (tool?.snippet) toolSnippets[name] = tool.snippet;
      if (tool?.guidelines) promptGuidelines.push(...tool.guidelines);
    }

    return { selectedTools, toolSnippets, promptGuidelines };
  }

  getPromptSpeakElementContext(): SpeakElementPromptContext {
    return { elements: this.speakElements.getPromptElements() };
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.unsubscribeOutputBridge();
    this.agentSession.dispose();

    for (const binding of this.bindings) {
      void binding.cleanup?.dispose?.();
    }
    this.bindings = [];
    this.pendingReplyContexts.length = 0;
  }

  async reloadExtensions(definitions: ExtensionDefinition[]): Promise<ChannelReloadResult> {
    if (this.disposed) {
      return {
        channelKey: this.channelKey,
        success: false,
        loadedCount: 0,
        error: "ChannelSession is disposed",
      };
    }

    const session = this;

    const host: ExtensionBindingHost = {
      channel: this.channel,
      tool: {
        getActive: () => this.agentSession.getActiveToolNames(),
        setActive: (toolNames) => this.agentSession.setActiveToolsByName(toolNames),
      },
      session: {
        getName: () => this.sessionManager.getSessionName(),
        setName: (name) => this.sessionManager.appendSessionInfo(name),
        appendEntry: (customType, data) => this.sessionManager.appendCustomEntry(customType, data),
        sendMessage: async (message, options) =>
          this.agentSession.sendCustomMessage(message as never, options as never),
        sendUserMessage: async (content, options) =>
          this.agentSession.sendUserMessage(content as never, options as never),
      },
      platform: {
        get name() {
          return host.channel.platform;
        },
        get bot() {
          return session.koishiBot;
        },
        registerSpeakElement: (definition) => session.speakElements.register(definition),
      },
    };

    const sorted = [...definitions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Dispose old bindings
    for (const old of this.bindings) {
      try {
        await old.cleanup?.dispose?.();
      } catch {
        // cleanup errors are non-fatal
      }
    }

    // Build next bindings (fail-open)
    const nextBindings: ExtensionBinding[] = [];
    const errors: string[] = [];

    for (const definition of sorted) {
      try {
        nextBindings.push(await createExtensionBinding(definition, host));
      } catch {
        errors.push(definition.id);
      }
    }

    // Swap live state
    this.hookRunner.clear();
    for (const binding of nextBindings) {
      for (const [event, handlers] of binding.handlers) {
        for (const handler of handlers) {
          this.hookRunner.on(event, handler);
        }
      }
    }

    const toolSnapshot = buildToolSnapshotFromBindings(nextBindings);
    this.agentSession.applyToolState(toolSnapshot);

    this.bindings = nextBindings;

    return {
      channelKey: this.channelKey,
      success: errors.length === 0,
      loadedCount: nextBindings.length,
      failedExtensions: errors.length > 0 ? errors : undefined,
      error: errors.length > 0 ? `Failed extensions: ${errors.join(", ")}` : undefined,
    };
  }
}

export function isChannelAllowed(
  platform: string,
  channelId: string,
  type: "private" | "group",
  allowedChannels: ChannelIdentifier[],
): boolean {
  return allowedChannels.some((channel) => {
    const platformMatch = channel.platform === "*" || channel.platform === platform;
    const channelMatch = channel.channelId === "*" || channel.channelId === channelId;
    return platformMatch && channelMatch && channel.type === type;
  });
}
