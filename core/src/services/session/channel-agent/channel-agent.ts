import type { ModelMessage } from "@ai-sdk/provider-utils";
import { stepCountIs, ToolLoopAgent } from "ai";
import type {
  LanguageModel,
  OnFinishEvent,
  OnStepFinishEvent,
  PrepareStepResult,
  ToolSet,
} from "ai";
import { Bot, Context } from "koishi";

import {
  buildSessionContext,
  convertAgentMessagesToModelMessages,
  type AgentAssistantMessage,
  type AgentAssistantThinkingPart,
  type AgentTextPart,
  type AgentToolCallPart,
  type AgentToolMessage,
  type AgentUsage,
  type ChannelMessageDetails,
  type SessionEntry,
  type SessionManager,
} from "../session-manager";
import type { ChannelEvent, ChannelKey, ResponseEndReason, ResponseEndRecord } from "../types";
import { judgeWillingness } from "../willingness";
import { extractMessages } from "./output";
import type { ChannelAgentOptions } from "./types";
import type { ResponseState } from "./types";

// ============================================================================
// ChannelAgent
// ============================================================================

/**
 * Per-channel agent wrapping AI SDK ToolLoopAgent + SessionManager.
 *
 * Responsibilities:
 * - Receive incoming messages, persist them, check willingness
 * - Schedule and execute AI responses via ToolLoopAgent
 * - Persist AI response steps to SessionManager
 * - Manage concurrency (prevent parallel generate() calls per channel)
 */
export class ChannelAgent {
  readonly bot: Bot;
  readonly sessionManager: SessionManager;

  private agent: ToolLoopAgent;
  private options: ChannelAgentOptions;
  private responseState: ResponseState = "idle";
  private abortController: AbortController | null = null;
  private responseQueue: Array<() => void> = [];
  private responseStartTime = 0;
  private stepsCompleted = 0;

  constructor(
    private ctx: Context,
    options: ChannelAgentOptions,
  ) {
    this.options = options;
    this.bot = options.bot;
    this.sessionManager = options.sessionManager;
    this.agent = this.createAgent();
  }

  // =========================================================================
  // Agent Construction
  // =========================================================================

  private createAgent(): ToolLoopAgent {
    const model = this.ctx["yesimbot.model"].resolve(this.options.modelId);
    return new ToolLoopAgent({
      model,
      tools: this.options.tools ?? ({} as ToolSet),
      stopWhen: stepCountIs(this.options.maxSteps ?? 20),
      timeout: {
        totalMs: this.options.responseTimeoutMs ?? 60000,
        chunkMs: this.options.chunkTimeoutMs ?? 10000,
      },
      prepareStep: this.handlePrepareStep.bind(this),
      onStepFinish: this.handleStepFinish.bind(this),
      onFinish: this.handleFinish.bind(this),
    });
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Process an incoming channel event.
   *
   * 1. Persist the message as CustomMessageEntry (immediately, never lost)
   * 2. Run willingness check
   * 3. If should respond, schedule a response
   */
  async receive(event: ChannelEvent): Promise<void> {
    // 1. Persist to JSONL immediately
    const content = formatChannelMessage(event);
    const details: ChannelMessageDetails = {
      userId: event.userId,
      username: event.username,
      platform: event.platform,
      channelId: event.channelId,
      messageId: event.messageId,
      isDirect: event.isDirect,
      atSelf: event.atSelf,
      isReplyToBot: event.isReplyToBot,
    };
    this.sessionManager.appendCustomMessageEntry("channel_message", content, false, details);

    // 2. Willingness check
    const selfId = event.bot?.selfId ?? "";
    const willingness = judgeWillingness({
      isDirect: event.isDirect,
      atSelf: event.atSelf,
      isReplyToBot: event.isReplyToBot,
      content: event.content,
      selfId,
      senderId: event.userId,
    });

    if (!willingness.shouldRespond) {
      return;
    }

    // 3. Schedule response
    this.scheduleResponse();
  }

  /** Abort the current response if one is in progress. */
  abort(): void {
    if (this.abortController && this.responseState === "responding") {
      this.responseState = "aborting";
      this.abortController.abort();
    }
  }

  /** Current response state. */
  getResponseState(): ResponseState {
    return this.responseState;
  }

  // =========================================================================
  // Response Scheduling
  // =========================================================================

  private scheduleResponse(): void {
    if (this.responseState === "responding") {
      // Already responding — queue a follow-up response
      this.responseQueue.push(() => {
        this.runResponse().catch(() => {});
      });
      return;
    }
    this.runResponse().catch(() => {});
  }

  private hasAccumulatedMessagesSinceResponse(): boolean {
    const entries = this.sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.type !== "custom_message" || entry.customType !== "channel_message") {
        continue;
      }

      const entryTime = Date.parse(entry.timestamp);
      if (Number.isNaN(entryTime)) {
        return false;
      }

      return entryTime > this.responseStartTime;
    }
    return false;
  }

  private evaluateAccumulatedMessages(): void {
    const entries = this.sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.type !== "custom_message" || entry.customType !== "channel_message") {
        continue;
      }

      const details = entry.details as ChannelMessageDetails | undefined;
      if (!details) {
        return;
      }

      const selfId = this.options.bot?.selfId ?? "";
      const willingness = judgeWillingness({
        isDirect: details.isDirect,
        atSelf: details.atSelf,
        isReplyToBot: details.isReplyToBot,
        content: typeof entry.content === "string" ? entry.content : "",
        selfId,
        senderId: details.userId,
      });

      if (willingness.shouldRespond) {
        this.scheduleResponse();
      }
      return;
    }
  }

  private async runResponse(): Promise<void> {
    this.responseState = "responding";
    this.abortController = new AbortController();
    this.responseStartTime = Date.now();
    this.stepsCompleted = 0;

    const timeoutMs = this.options.responseTimeoutMs ?? 60000;
    let endReason: ResponseEndReason = "normal";
    let errorMessage: string | undefined;
    let timedOut = false;

    const watchdog = setTimeout(() => {
      if (this.responseState === "responding") {
        timedOut = true;
        endReason = "timeout";
        this.abortController?.abort();
      }
    }, timeoutMs);

    try {
      // Resolve instructions
      const instructions =
        typeof this.options.instructions === "function"
          ? await this.options.instructions()
          : this.options.instructions;

      const { messages } = buildGenerateInputForTest({
        instructions,
        sessionEntries: [...this.sessionManager.getEntries()],
      });

      // Run agent
      await this.agent.generate({
        messages,
        abortSignal: this.abortController.signal,
      });
    } catch (err: unknown) {
      if (this.abortController?.signal.aborted) {
        endReason = timedOut ? "timeout" : "abort";
      } else {
        endReason = "error";
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    } finally {
      clearTimeout(watchdog);

      const record: ResponseEndRecord = {
        endReason,
        durationMs: Date.now() - this.responseStartTime,
        stepsCompleted: this.stepsCompleted,
        error: errorMessage,
      };
      this.sessionManager.appendCustomEntry<ResponseEndRecord>("response_end", record);

      this.responseState = "ended";
      this.abortController = null;

      this.responseState = "idle";

      // D-06: Post-response re-evaluation
      const next = this.responseQueue.shift();
      if (next) {
        next();
      } else if (this.hasAccumulatedMessagesSinceResponse()) {
        this.evaluateAccumulatedMessages();
      }
    }
  }

  // =========================================================================
  // ToolLoopAgent Callbacks
  // =========================================================================

  /**
   * Called before each LLM step. Used for context window management.
   */
  private handlePrepareStep(_opts: {
    steps: unknown[];
    stepNumber: number;
    model: unknown;
    messages: ModelMessage[];
  }): PrepareStepResult {
    const maxTokenEstimate = 100000;
    const estimatedTokens = JSON.stringify(_opts.messages).length / 4;

    if (estimatedTokens > maxTokenEstimate) {
      const [system, ...rest] = _opts.messages;
      if (!system) {
        return {};
      }

      const keepCount = Math.max(10, Math.floor(rest.length / 2));
      const trimmed = rest.slice(-keepCount);
      return { messages: [system, ...trimmed] };
    }

    return {};
  }

  /**
   * Called after each LLM step. Persists messages and sends text to channel.
   */
  private handleStepFinish(stepResult: OnStepFinishEvent): void {
    this.stepsCompleted++;

    const responseMessages = stepResult.response?.messages;
    if (responseMessages) {
      for (const msg of responseMessages) {
        if (msg.role === "assistant") {
          const agentMsg = createAgentAssistantMessage({
            content: msg.content,
            model: stepResult.model,
            usage: stepResult.usage,
            finishReason: stepResult.finishReason,
          });
          this.sessionManager.appendMessage(agentMsg);
        } else if (msg.role === "tool") {
          const agentMsg: AgentToolMessage = {
            role: "tool",
            content: Array.isArray(msg.content)
              ? (msg.content as Array<Record<string, unknown>>)
                  .filter((p) => p.type === "tool-result")
                  .map((p) => ({
                    type: "tool-result" as const,
                    toolCallId: p.toolCallId as string,
                    toolName: p.toolName as string,
                    result: p.output,
                    isError: p.isError as boolean | undefined,
                  }))
              : [],
            timestamp: Date.now(),
          };
          this.sessionManager.appendMessage(agentMsg);
        }
      }
    }

    // Send only <message>-tagged content to channel
    if (stepResult.text) {
      const outbound = extractMessages(stepResult.text);
      for (const segment of outbound) {
        this.bot.sendMessage(this.options.channelId, segment).catch((err) => {
          this.ctx.logger.error(
            `Failed to send message to channel ${this.options.channelId}:`,
            err,
          );
        });
      }
    }
  }

  /**
   * Called when the entire agent run finishes. Check for auto-compaction.
   */
  private handleFinish(_event: OnFinishEvent): void {
    // TODO: Check if auto-compaction is needed based on totalUsage
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Format a channel event into a readable text string for LLM context. */
function formatChannelMessage(event: ChannelEvent): string {
  return `[${event.username}]: ${event.content}`;
}

function createAgentUsage(usage?: {
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): AgentUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    cacheRead: usage.cacheRead ?? 0,
    cacheWrite: usage.cacheWrite ?? 0,
  };
}

/** Normalize AI SDK AssistantContent into AgentAssistantMessage content parts. */
export function normalizeAssistantContent(
  content: unknown[],
): Array<AgentTextPart | AgentToolCallPart | AgentAssistantThinkingPart> {
  if (!Array.isArray(content)) return [];
  const parts: Array<AgentTextPart | AgentToolCallPart | AgentAssistantThinkingPart> = [];
  for (const part of content) {
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") {
      parts.push({ type: "text", text: p.text });
    } else if (p.type === "tool-call") {
      parts.push({
        type: "tool-call",
        toolCallId: p.toolCallId as string,
        toolName: p.toolName as string,
        args: p.input ?? p.args,
      });
    } else if ((p.type === "reasoning" || p.type === "thinking") && typeof p.text === "string") {
      parts.push({
        type: "thinking",
        text: p.text,
        signature: typeof p.signature === "string" ? p.signature : undefined,
      });
    }
  }
  return parts;
}

export function createAgentAssistantMessage(input: {
  content: string | unknown[];
  model?: { provider?: string; modelId?: string };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  finishReason?: string;
}): AgentAssistantMessage {
  const usageRecord = input.usage as Record<string, unknown> | undefined;
  const usage = createAgentUsage({
    inputTokens: input.usage?.inputTokens,
    outputTokens: input.usage?.outputTokens,
    cacheRead: typeof usageRecord?.cacheRead === "number" ? usageRecord.cacheRead : 0,
    cacheWrite: typeof usageRecord?.cacheWrite === "number" ? usageRecord.cacheWrite : 0,
  });

  return {
    role: "assistant",
    content:
      typeof input.content === "string" ? input.content : normalizeAssistantContent(input.content),
    timestamp: Date.now(),
    provider: input.model?.provider ?? "unknown",
    model: input.model?.modelId ?? "unknown",
    usage,
    finishReason: input.finishReason,
  };
}

export function buildGenerateInputForTest(input: {
  instructions: string;
  sessionEntries: SessionEntry[];
}): { messages: ModelMessage[] } {
  const sessionContext = buildSessionContext(input.sessionEntries);
  const modelMessages = convertAgentMessagesToModelMessages(sessionContext.agentMessages);
  return {
    messages: [{ role: "system", content: input.instructions }, ...modelMessages],
  };
}
