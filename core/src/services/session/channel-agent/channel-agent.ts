import { join } from "node:path";

import type { ModelMessage } from "@ai-sdk/provider-utils";
import type { OnFinishEvent, OnStepFinishEvent, PrepareStepResult, ToolSet } from "ai";
import { stepCountIs, ToolLoopAgent } from "ai";
import { Bot, Context } from "koishi";

import {
  buildSessionContext,
  convertAgentMessagesToModelMessages,
  type AgentAssistantMessage,
  type AgentAssistantThinkingPart,
  type AgentTextPart,
  type AgentToolCallPart,
  type AgentToolMessage,
  type AgentToolResultPart,
  type AgentUsage,
  type ChannelMessageDetails,
  type SessionEntry,
  type SessionManager,
} from "../session-manager";
import type { ChannelEvent, ResponseEndReason, ResponseEndRecord } from "../types";
import { judgeWillingness } from "../willingness";
import {
  HIGH_RISK_ACTIONS,
  collectPathCandidates,
  inferActionType,
  isHighRiskAction,
  logSecurityEvent,
  validateWorkspacePath,
  wrapToolsWithWorkspaceGuard,
} from "../workspace-guard";
import { extractMessages } from "./output";
import type { ChannelAgentOptions, ResponseState } from "./types";

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
  readonly maxSteps: number;
  readonly baseTimeoutMs: number;
  readonly perStepTimeoutMs: number;
  readonly chunkTimeoutMs: number;

  private options: ChannelAgentOptions;
  private responseState: ResponseState = "idle";
  private abortController: AbortController | null = null;
  private responseQueue: Array<() => void> = [];
  private responseStartTime = 0;
  private stepsCompleted = 0;
  private responseToolSnapshot: ToolSet = {};
  private responseActiveTools: string[] = [];

  constructor(
    private ctx: Context,
    options: ChannelAgentOptions,
  ) {
    this.options = options;
    this.bot = options.bot;
    this.sessionManager = options.sessionManager;
    this.maxSteps = options.maxSteps ?? 20;
    this.baseTimeoutMs = options.baseTimeoutMs ?? options.responseTimeoutMs ?? 60000;
    this.perStepTimeoutMs = options.perStepTimeoutMs ?? 30000;
    this.chunkTimeoutMs = options.chunkTimeoutMs ?? 10000;
  }

  // =========================================================================
  // Agent Construction
  // =========================================================================

  private createAgent(): ToolLoopAgent<never, ToolSet> {
    const model = this.ctx["yesimbot.model"].resolve(this.options.modelId);
    const cumulativeTimeoutMs = this.baseTimeoutMs + this.maxSteps * this.perStepTimeoutMs;
    return new ToolLoopAgent<never, ToolSet>({
      model,
      tools: {},
      stopWhen: stepCountIs(this.maxSteps),
      timeout: {
        totalMs: cumulativeTimeoutMs,
        chunkMs: this.chunkTimeoutMs,
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
    const willingness = await judgeWillingness(this.ctx, {
      isDirect: event.isDirect,
      atSelf: event.atSelf,
      isReplyToBot: event.isReplyToBot,
      content: event.content,
      selfId,
      senderId: event.userId,
      judgeEnabled: this.options.judgeEnabled,
      judgeModel: this.options.judgeModel,
      judgeTimeoutMs: this.options.judgeTimeoutMs,
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

  private async evaluateAccumulatedMessages(): Promise<void> {
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
      const willingness = await judgeWillingness(this.ctx, {
        isDirect: details.isDirect,
        atSelf: details.atSelf,
        isReplyToBot: details.isReplyToBot,
        content: typeof entry.content === "string" ? entry.content : "",
        selfId,
        senderId: details.userId,
        judgeEnabled: this.options.judgeEnabled,
        judgeModel: this.options.judgeModel,
        judgeTimeoutMs: this.options.judgeTimeoutMs,
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

    const timeoutMs = this.baseTimeoutMs + this.maxSteps * this.perStepTimeoutMs;
    let endReason: ResponseEndReason = "normal";
    let errorMessage: string | undefined;
    let responseEndPersisted = false;
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

      const rawTools = this.ctx["yesimbot.plugin"]?.getToolSet() ?? {};
      const workspaceRoot = join(this.options.basePath, "workspace");
      const channelKey = this.sessionManager.getChannelKey();
      const sessionId = this.sessionManager.getSessionId();

      this.responseToolSnapshot = wrapToolsWithWorkspaceGuard(rawTools, {
        workspaceRoot,
        channelKey,
        sessionId,
        logger: this.ctx.logger,
      });
      this.responseActiveTools = Object.keys(this.responseToolSnapshot);

      const agent = this.createAgent();
      Object.assign(agent.tools, this.responseToolSnapshot);

      // Run agent
      await agent.generate({
        messages,
        abortSignal: this.abortController.signal,
      });
    } catch (err: unknown) {
      if (this.abortController?.signal.aborted) {
        endReason = timedOut ? "timeout" : "abort";
      } else {
        endReason = "error";
        errorMessage = err instanceof Error ? err.message : String(err);

        this.ctx.logger.error(
          `Response failed for ${this.options.platform}:${this.options.channelId}: ${errorMessage}`,
        );

        const record: ResponseEndRecord = {
          endReason,
          durationMs: Date.now() - this.responseStartTime,
          stepsCompleted: this.stepsCompleted,
          error: errorMessage,
        };
        this.sessionManager.appendCustomEntry<ResponseEndRecord>("response_end", record);
        responseEndPersisted = true;
        this.responseState = "ended";
      }
    } finally {
      clearTimeout(watchdog);

      if (!responseEndPersisted) {
        const record: ResponseEndRecord = {
          endReason,
          durationMs: Date.now() - this.responseStartTime,
          stepsCompleted: this.stepsCompleted,
          error: errorMessage,
        };
        this.sessionManager.appendCustomEntry<ResponseEndRecord>("response_end", record);
      }

      this.responseState = "ended";
      this.abortController = null;

      this.responseState = "idle";

      // D-06: Post-response re-evaluation
      const next = this.responseQueue.shift();
      if (next) {
        next();
      } else if (this.hasAccumulatedMessagesSinceResponse()) {
        this.evaluateAccumulatedMessages().catch(() => {});
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
      return {
        activeTools: this.responseActiveTools,
        messages: [system, ...trimmed],
      };
    }

    return {
      activeTools: this.responseActiveTools,
    };
  }

  /**
   * Called after each LLM step. Persists messages and sends text to channel.
   */
  private handleStepFinish(stepResult: OnStepFinishEvent): void {
    this.stepsCompleted++;

    const workspaceRoot = join(this.options.basePath, "workspace");
    const blockedToolResultParts: AgentToolResultPart[] = [];
    const blockedToolCallIds = new Set<string>();
    const channelKey = this.sessionManager.getChannelKey();
    const sessionId = this.sessionManager.getSessionId();

    for (const toolCall of stepResult.toolCalls) {
      const actionType = inferActionType(toolCall.toolName);
      const highRisk = isHighRiskAction(actionType);
      const inputPaths = collectPathCandidates(toolCall.input);

      if (highRisk && inputPaths.length === 0) {
        logSecurityEvent(this.ctx.logger, {
          channel: channelKey,
          sessionId,
          actionType,
          allowed: true,
          reason: "high_risk_action_without_path",
        });
      }

      for (const candidatePath of inputPaths) {
        const allowed = validateWorkspacePath(candidatePath, workspaceRoot);

        logSecurityEvent(this.ctx.logger, {
          channel: channelKey,
          sessionId,
          actionType,
          allowed,
          path: candidatePath,
          reason: allowed ? "workspace_boundary_allow" : "workspace_boundary_deny",
        });

        if (!allowed) {
          blockedToolCallIds.add(toolCall.toolCallId);
          blockedToolResultParts.push({
            type: "tool-result",
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            result: "Access denied: file path outside workspace boundary",
            isError: true,
          });
          break;
        }
      }
    }

    if (blockedToolResultParts.length > 0) {
      const blockedMessage: AgentToolMessage = {
        role: "tool",
        content: blockedToolResultParts,
        timestamp: Date.now(),
      };
      this.sessionManager.appendMessage(blockedMessage);
    }

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
          const toolParts = Array.isArray(msg.content)
            ? (msg.content as Array<Record<string, unknown>>).filter(
                (p) => p.type === "tool-result" && !blockedToolCallIds.has(p.toolCallId as string),
              )
            : [];

          if (toolParts.length === 0) {
            continue;
          }

          const agentMsg: AgentToolMessage = {
            role: "tool",
            content: toolParts.map((p) => ({
              type: "tool-result" as const,
              toolCallId: p.toolCallId as string,
              toolName: p.toolName as string,
              result: p.output,
              isError: p.isError as boolean | undefined,
            })),
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
