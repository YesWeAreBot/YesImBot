import { Agent } from "@yesimbot/agent/agent";
import type { ChatModelRef } from "@yesimbot/agent/ai";
import {
  AgentSession,
  convertToLlm,
  HookRunner,
  type SessionManager,
} from "@yesimbot/agent/session";
import type { Bot, Logger, Session } from "koishi";

import { type BotInfo } from "../../services/extension/built-in/system-prompt.js";
import type { ChannelIdentifier, ChannelKey } from "../../shared/types.js";
import { AthenaBot } from "../bot/bot.js";
import { serializeAthenaEvent } from "../bot/events.js";
import type { ChannelEventContext } from "../bot/observer-types.js";
import type { PresenterCatalog } from "../bot/presentation.js";
import { createSpeakElementRegistry, type SpeakElementRegistry } from "../bot/speak.js";
import type { AthenaEvent } from "../bot/types.js";
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
import { buildAgentSessionConfig } from "./helpers.js";
import { RuntimeSettingsManager, type PartialRuntimeSettings } from "./settings.js";

export interface ChannelSessionDeps {
  channel: Channel;
  sessionManager: SessionManager;
  koishiBot: Bot;
  model: ChatModelRef;
  settings: {
    globalPath: string;
    localPath: string;
    seed?: PartialRuntimeSettings;
  };
  behavior: {
    allowedChannels: ChannelIdentifier[];
    willingnessManager: {
      shouldReply(event: AthenaEvent, triggerCandidate: boolean): { decision: boolean };
    };
  };
  extensions: {
    definitions: ExtensionDefinition[];
  };
  bot: {
    presenterCatalog: PresenterCatalog;
  };
  logger: Logger;
}

export class ChannelSession {
  readonly channelKey: ChannelKey;
  readonly channel: Channel;
  readonly sessionManager: SessionManager;
  readonly koishiBot: Bot;
  readonly agentSession: AgentSession;
  readonly hookRunner: HookRunner;
  readonly bot: AthenaBot;
  readonly botInfo: BotInfo;

  private readonly agent: Agent;
  private readonly allowedChannels: ChannelIdentifier[];
  private readonly willingnessManager: ChannelSessionDeps["behavior"]["willingnessManager"];
  private readonly pendingOriginSessions: Array<Session | undefined> = [];
  private readonly unsubscribeOutputBridge: () => void;
  private readonly speakElements: SpeakElementRegistry;
  private bindings: ExtensionBinding[] = [];
  private disposed = false;

  constructor(deps: ChannelSessionDeps) {
    this.channel = deps.channel;
    this.sessionManager = deps.sessionManager;
    this.koishiBot = deps.koishiBot;
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

    this.bot = new AthenaBot({
      channel: { ...deps.channel, bot: deps.koishiBot },
      presenterCatalog: deps.bot.presenterCatalog,
      speakElements: this.speakElements,
      deliverySettings: merged.delivery,
      appendEntry: (customType, data) => this.sessionManager.appendCustomEntry(customType, data),
    });

    this.botInfo = {
      selfId: deps.koishiBot.selfId,
      selfName: deps.koishiBot.user?.nick || deps.koishiBot.user?.name || "(unknown)",
    };

    // Assistant output bridge
    this.unsubscribeOutputBridge = this.agentSession.subscribe((event) => {
      if (event.type !== "message_end") return;
      if (event.message.role !== "assistant") return;

      const text = event.message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");

      if (!text) return;

      const originSession = this.pendingOriginSessions.shift();

      void this.bot.speak(text, { originSession, modelElapsedMs: 0 }).catch(() => undefined);
    });
  }

  async handleEvent(event: AthenaEvent, context?: ChannelEventContext): Promise<void> {
    if (this.disposed) return;

    const channelAllowed = isChannelAllowed(
      event.source.platform,
      event.source.channelId,
      event.source.conversationType === "private" ? "private" : "group",
      this.allowedChannels,
    );

    const { decision } = this.willingnessManager.shouldReply(
      event,
      event.metadata.triggerCandidate,
    );
    const shouldTriggerTurn = channelAllowed && (event.metadata.triggerCandidate || decision);

    if (!event.metadata.persist && !shouldTriggerTurn) {
      return;
    }

    const presentation = await this.bot.present(event);

    if (presentation === null && !event.metadata.persist) {
      return;
    }

    await this.agentSession.sendCustomMessage(
      {
        customType: "athena:event",
        content: presentation?.content ?? [],
        display: presentation?.visible ?? false,
        details:
          presentation?.details ??
          (event.metadata.persist ? serializeAthenaEvent(event) : undefined),
      },
      shouldTriggerTurn ? { triggerTurn: true, deliverAs: "followUp" } : { triggerTurn: false },
    );

    if (shouldTriggerTurn) {
      this.pendingOriginSessions.push(context?.originSession);
    }
  }

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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.unsubscribeOutputBridge();
    this.agentSession.dispose();

    for (const binding of this.bindings) {
      void binding.cleanup?.dispose?.();
    }
    this.bindings = [];
    this.pendingOriginSessions.length = 0;
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
      bot: {
        registerSpeakElement: (definition) => this.speakElements.register(definition),
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
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
