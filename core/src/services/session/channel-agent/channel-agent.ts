import { join } from "node:path";

import type { ModelMessage } from "@ai-sdk/provider-utils";
import type {
  LanguageModel,
  OnFinishEvent,
  OnStepFinishEvent,
  PrepareStepResult,
  ToolSet,
} from "ai";
import { stepCountIs, ToolLoopAgent } from "ai";
import { Bot, Context } from "koishi";

import { renderInboundChannelMessage } from "../channel-message";
import { compact, prepareCompaction, shouldCompact, type CompactionSettings } from "../compaction";
import { estimateContextTokens } from "../compaction/estimate";
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
  type InboundChannelMessageDetails,
  type SessionEntry,
  type SessionManager,
} from "../session-manager";
import type { ChannelEvent, ResponseEndRecord } from "../types";
import { judgeWillingness } from "../willingness";
import { LocalFilesystem, LocalSandbox, Workspace } from "../workspace";
import { TurnFinalizer } from "./finalization/turn-finalizer";
import { createSendMessageTool, isSendMessageResult } from "./send-message-tool";
import type { ChannelAgentOptions, CompactionRunResult, ResponseState } from "./types";

const PROTOCOL_GUIDANCE_TEXT =
  "[Protocol Guidance]\n" +
  "Visible IM replies must be sent with the send_message tool. " +
  "Your previous assistant text was not delivered to the user. " +
  "Re-issue the full visible reply with send_message, and only set request_heartbeat when you intentionally need another model turn after sending.";

const MAX_PROTOCOL_RETRIES_PER_RESPONSE = 1;

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
  readonly contextWindow: number;

  private options: ChannelAgentOptions;
  private readonly compactionSettings: CompactionSettings;
  private responseState: ResponseState = "idle";
  private abortController: AbortController | null = null;
  private responseQueue: Array<() => void> = [];
  private responseStartTime = 0;
  private stepsCompleted = 0;
  private responseToolSnapshot: ToolSet = {};
  private responseActiveTools: string[] = [];
  private readonly turnFinalizer = new TurnFinalizer();
  private pendingProtocolRetry = false;
  private protocolRetryCount = 0;
  private protocolError = false;
  private heartbeatRequested = false;
  private sendFailure = false;
  private thrownError: string | undefined;
  private seenAssistantToolCallIds = new Set<string>();
  private seenToolResultCallIds = new Set<string>();
  private seenChannelMessageSegmentIds = new Set<string>();

  constructor(
    private ctx: Context,
    options: ChannelAgentOptions,
  ) {
    this.options = options;
    this.bot = options.bot;
    this.sessionManager = options.sessionManager;
    this.maxSteps = options.maxSteps ?? 20;
    this.baseTimeoutMs = options.baseTimeoutMs ?? 60000;
    this.perStepTimeoutMs = options.perStepTimeoutMs ?? 30000;
    this.chunkTimeoutMs = options.chunkTimeoutMs ?? 10000;
    this.compactionSettings = {
      enabled: options.compactionEnabled ?? true,
      reserveTokens: options.compactionReserveTokens ?? 16384,
      keepRecentTokens: options.compactionKeepRecentTokens ?? 20000,
    };
    this.contextWindow = options.contextWindow ?? 128000;
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
      stopWhen: [
        stepCountIs(this.maxSteps),
        ({ steps }) => hasCompletedSendMessageWithoutHeartbeat(steps),
      ],
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
    const content = renderInboundChannelMessage(event);
    const details: ChannelMessageDetails = {
      direction: "inbound",
      timestamp: event.timestamp,
      userId: event.userId,
      username: event.username,
      nickname: event.nickname ?? event.username,
      identity: event.identity ?? (event.isDirect ? "direct-user" : "member"),
      platform: event.platform,
      channelId: event.channelId,
      messageId: event.messageId,
      isDirect: event.isDirect,
      atSelf: event.atSelf,
      isReplyToBot: event.isReplyToBot,
      replyTo: event.replyTo,
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

      if (!getInboundChannelMessageDetails(entry.details)) {
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

      const details = getInboundChannelMessageDetails(entry.details);
      if (!details) {
        continue;
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

  private async runResponse(protocolRetry = false): Promise<void> {
    if (!protocolRetry) {
      this.protocolRetryCount = 0;
    }

    this.pendingProtocolRetry = false;
    this.seenAssistantToolCallIds.clear();
    this.seenToolResultCallIds.clear();
    this.seenChannelMessageSegmentIds.clear();
    this.responseState = "responding";
    this.abortController = new AbortController();
    this.responseStartTime = Date.now();
    this.stepsCompleted = 0;

    const timeoutMs = this.baseTimeoutMs + this.maxSteps * this.perStepTimeoutMs;
    this.protocolError = false;
    this.heartbeatRequested = false;
    this.sendFailure = false;
    this.thrownError = undefined;
    let timedOut = false;

    const watchdog = setTimeout(() => {
      if (this.responseState === "responding") {
        timedOut = true;
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

      const sendMessageTool = createSendMessageTool({
        bot: this.bot,
        channelId: this.options.channelId,
      });
      const pluginTools = this.ctx["yesimbot.plugin"]?.getToolSet() ?? {};
      if ("send_message" in pluginTools) {
        throw new Error("Tool name reserved: send_message");
      }

      const workspaceTools = await this.buildWorkspaceTools();
      if ("send_message" in workspaceTools) {
        throw new Error("Tool name reserved: send_message");
      }

      this.responseToolSnapshot = {
        send_message: sendMessageTool,
        ...pluginTools,
        ...workspaceTools,
      };
      this.responseActiveTools = Object.keys(this.responseToolSnapshot);

      const agent = this.createAgent();
      Object.assign(agent.tools, this.responseToolSnapshot);

      // Run agent
      if (this.options.streaming) {
        const result = await agent.stream({
          messages,
          abortSignal: this.abortController.signal,
        });
        await result.consumeStream();
      } else {
        await agent.generate({
          messages,
          abortSignal: this.abortController.signal,
        });
      }
    } catch (err: unknown) {
      if (!this.abortController?.signal.aborted) {
        this.thrownError = err instanceof Error ? err.message : String(err);

        this.ctx.logger.error(
          `Response failed for ${this.options.platform}:${this.options.channelId}: ${this.thrownError}`,
        );
      }
    } finally {
      clearTimeout(watchdog);

      if (this.pendingProtocolRetry) {
        this.responseState = "idle";
        this.abortController = null;
        this.runResponse(true).catch(() => {});
        return;
      }

      const endReason = this.turnFinalizer.resolveEndReason({
        aborted: this.abortController?.signal.aborted === true && !timedOut,
        timedOut,
        protocolError: this.protocolError,
        heartbeatRequested: this.heartbeatRequested,
        sendFailure: this.sendFailure,
        thrownError: this.thrownError,
      });
      const record: ResponseEndRecord = {
        endReason,
        durationMs: Date.now() - this.responseStartTime,
        stepsCompleted: this.stepsCompleted,
        error: this.thrownError,
      };
      this.turnFinalizer.persist(this.sessionManager, record);

      this.responseState = "ended";
      this.abortController = null;

      this.responseState = "idle";

      if (this.pendingProtocolRetry) {
        this.runResponse(true).catch(() => {});
        return;
      }

      // D-06: Post-response re-evaluation
      const nextAction = this.turnFinalizer.nextAction({
        hasQueuedResponse: Boolean(this.responseQueue[0]),
        hasAccumulatedMessages: this.hasAccumulatedMessagesSinceResponse(),
      });

      switch (nextAction) {
        case "run-queued": {
          const next = this.responseQueue.shift();
          if (next) {
            next();
          }
          break;
        }
        case "re-evaluate-accumulated":
          this.evaluateAccumulatedMessages().catch(() => {});
          break;
        case "idle":
          break;
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
   * Called after each LLM step. Persists messages and enforces tool-first outbound protocol.
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

          if (isDuplicateAssistantToolCallMessage(agentMsg, this.seenAssistantToolCallIds)) {
            continue;
          }

          this.sessionManager.appendMessage(agentMsg);
          rememberAssistantToolCallIds(agentMsg, this.seenAssistantToolCallIds);

          const assistantText = extractAssistantText(agentMsg.content);
          if (assistantText.trim().length > 0 && !hasSendMessageToolCall(agentMsg.content)) {
            if (this.protocolRetryCount < MAX_PROTOCOL_RETRIES_PER_RESPONSE) {
              this.protocolRetryCount++;
              this.pendingProtocolRetry = true;
              this.sessionManager.appendCustomMessageEntry(
                "protocol_guidance",
                PROTOCOL_GUIDANCE_TEXT,
                false,
              );
            } else {
              this.protocolError = true;
            }
          }
        } else if (msg.role === "tool") {
          const toolParts = Array.isArray(msg.content)
            ? (msg.content as Array<Record<string, unknown>>).filter(
                (p) => p.type === "tool-result",
              )
            : [];

          if (toolParts.length === 0) {
            continue;
          }

          const freshToolParts = toolParts.filter(
            (part) => !this.seenToolResultCallIds.has(String(part.toolCallId)),
          );
          if (freshToolParts.length === 0) {
            continue;
          }

          const agentMsg: AgentToolMessage = {
            role: "tool",
            content: freshToolParts.map((p) => ({
              type: "tool-result" as const,
              toolCallId: p.toolCallId as string,
              toolName: p.toolName as string,
              result: unwrapToolResult(p.output),
              isError: p.isError as boolean | undefined,
            })),
            timestamp: Date.now(),
          };
          this.sessionManager.appendMessage(agentMsg);
          for (const part of freshToolParts) {
            this.seenToolResultCallIds.add(String(part.toolCallId));
          }

          for (const part of freshToolParts) {
            if (part.toolName !== "send_message") {
              continue;
            }

            const toolResult = unwrapToolResult(part.output);
            if (!isSendMessageResult(toolResult)) {
              continue;
            }

            if (toolResult.success === true) {
              this.heartbeatRequested = toolResult.requestHeartbeat;
            }

            if (toolResult.success === false && toolResult.segments.length === 0) {
              this.protocolError = true;
            }

            if (
              toolResult.success === false &&
              toolResult.segments.some(
                (segment) => segment.success === false || Boolean(segment.error),
              )
            ) {
              this.sendFailure = true;
              const firstErrorSegment = toolResult.segments.find(
                (segment) => segment.success === false || Boolean(segment.error),
              );
              if (firstErrorSegment?.error && !this.thrownError) {
                this.thrownError = firstErrorSegment.error;
              }
            }

            for (const segment of toolResult.segments) {
              if (segment.success !== true) {
                continue;
              }
              if (this.seenChannelMessageSegmentIds.has(segment.segmentId)) {
                continue;
              }
              this.seenChannelMessageSegmentIds.add(segment.segmentId);
              this.sessionManager.appendCustomMessageEntry(
                "channel_message",
                formatOutboundChannelMessage(segment.content),
                false,
                {
                  direction: "outbound",
                  platform: this.options.platform,
                  channelId: this.options.channelId,
                  toolCallId: toolResult.toolCallId,
                  utteranceId: toolResult.utteranceId,
                  index: segment.index,
                  messageIds: segment.messageIds,
                  requestHeartbeat: toolResult.requestHeartbeat,
                },
              );
            }
          }
        }
      }
    }
  }

  private handleFinish(event: OnFinishEvent): void {
    const totalUsage = event.totalUsage ?? event.usage;
    const contextTokens =
      getReliableInputTokens(totalUsage) ??
      estimateContextTokens(
        buildSessionContext([...this.sessionManager.getEntries()]).agentMessages,
      );

    if (!shouldCompact(contextTokens, this.contextWindow, this.compactionSettings)) {
      return;
    }

    this.runCompaction(contextTokens).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.ctx.logger.error(
        `Compaction failed for ${this.options.platform}:${this.options.channelId}: ${msg}`,
      );
    });
  }

  public async runCompaction(contextTokens: number): Promise<CompactionRunResult> {
    const entries = [...this.sessionManager.getEntries()];
    if (entries.length === 0) {
      return { compacted: false, reason: "empty-session" };
    }

    if (entries[entries.length - 1]?.type === "compaction") {
      return { compacted: false, reason: "already-compacted" };
    }

    const preparation = prepareCompaction(entries, this.compactionSettings, contextTokens);
    if (!preparation) {
      return { compacted: false, reason: "nothing-to-compact" };
    }

    const compactionModelId = this.options.compactionModel ?? this.options.modelId;
    const model: LanguageModel = this.ctx["yesimbot.model"].resolve(compactionModelId);
    const result = await compact(preparation, model);

    this.sessionManager.appendCompaction(
      result.summary,
      result.firstKeptEntryId,
      result.tokensBefore,
    );

    this.ctx.logger.info(
      `Compaction complete for ${this.options.platform}:${this.options.channelId}: ` +
        `tokensBefore=${result.tokensBefore}, contextTokens=${contextTokens}, ` +
        `summaryLength=${result.summary.length}, firstKeptEntryId=${result.firstKeptEntryId}`,
    );

    return {
      compacted: true,
      firstKeptEntryId: result.firstKeptEntryId,
      summaryLength: result.summary.length,
      tokensBefore: result.tokensBefore,
    };
  }

  private async buildWorkspaceTools(): Promise<ToolSet> {
    const enableWorkspace = this.options.enableWorkspace ?? true;
    if (!enableWorkspace) {
      return {};
    }

    const workspaceRoot = join(this.options.basePath, "workspace");
    const externalPath = this.options.externalPath;
    const enableFilesystem = this.options.enableFilesystem ?? true;
    const enableSandbox = this.options.enableSandbox ?? false;

    const filesystem = enableFilesystem
      ? new LocalFilesystem({
          basePath: workspaceRoot,
          externalPath,
        })
      : undefined;

    const sandbox = enableSandbox
      ? new LocalSandbox({
          workingDirectory: workspaceRoot,
          env: process.env,
        })
      : undefined;

    const workspace = new Workspace({
      filesystem,
      sandbox,
    });
    await workspace.init();
    return workspace.getAgentTools() as ToolSet;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function formatOutboundChannelMessage(content: string): string {
  return `[assistant]: ${content}`;
}

function createAgentUsage(usage?: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): AgentUsage | undefined {
  if (!usage || !hasNonZeroUsageValue(usage)) return undefined;

  const usageRecord = usage;
  const inputTokens = usageRecord.inputTokens ?? 0;
  const outputTokens = usageRecord.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usageRecord.totalTokens ?? inputTokens + outputTokens,
    cacheRead: usageRecord.cacheRead ?? 0,
    cacheWrite: usageRecord.cacheWrite ?? 0,
  };
}

function getReliableInputTokens(usage?: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): number | undefined {
  if (typeof usage?.inputTokens !== "number") {
    return undefined;
  }

  if (!Number.isFinite(usage.inputTokens) || usage.inputTokens <= 0) {
    return undefined;
  }

  return usage.inputTokens;
}

function hasNonZeroUsageValue(usage?: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): boolean {
  if (!usage) {
    return false;
  }

  return [
    usage.inputTokens,
    usage.outputTokens,
    usage.totalTokens,
    usage.cacheRead,
    usage.cacheWrite,
  ].some((value) => typeof value === "number" && Number.isFinite(value) && value !== 0);
}

function extractAssistantText(content: AgentAssistantMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part): part is AgentTextPart => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function hasSendMessageToolCall(content: AgentAssistantMessage["content"]): boolean {
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((part) => part.type === "tool-call" && part.toolName === "send_message");
}

function getAssistantToolCallIds(content: AgentAssistantMessage["content"]): string[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .filter((part): part is AgentToolCallPart => part.type === "tool-call")
    .map((part) => part.toolCallId);
}

function hasVisibleAssistantText(content: AgentAssistantMessage["content"]): boolean {
  return extractAssistantText(content).trim().length > 0;
}

function isDuplicateAssistantToolCallMessage(
  message: AgentAssistantMessage,
  seenToolCallIds: ReadonlySet<string>,
): boolean {
  const toolCallIds = getAssistantToolCallIds(message.content);
  if (toolCallIds.length === 0) {
    return false;
  }

  return (
    !hasVisibleAssistantText(message.content) && toolCallIds.every((id) => seenToolCallIds.has(id))
  );
}

function rememberAssistantToolCallIds(
  message: AgentAssistantMessage,
  seenToolCallIds: Set<string>,
): void {
  for (const toolCallId of getAssistantToolCallIds(message.content)) {
    seenToolCallIds.add(toolCallId);
  }
}

function unwrapToolResult(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as { type?: unknown; value?: unknown };
  if (candidate.type === "json") {
    return candidate.value;
  }

  return value;
}

function hasCompletedSendMessageWithoutHeartbeat(
  steps: Array<{ toolResults?: unknown[] }>,
): boolean {
  const lastStep = steps[steps.length - 1];
  if (!lastStep || !Array.isArray(lastStep.toolResults)) {
    return false;
  }

  return lastStep.toolResults.some((result) => {
    if (!result || typeof result !== "object") {
      return false;
    }

    const candidate = result as { toolName?: unknown; output?: unknown };
    if (candidate.toolName !== "send_message") {
      return false;
    }

    const output = unwrapToolResult(candidate.output);
    return (
      isSendMessageResult(output) && output.success === true && output.requestHeartbeat === false
    );
  });
}

function getInboundChannelMessageDetails(details: unknown): InboundChannelMessageDetails | null {
  if (!details || typeof details !== "object") {
    return null;
  }

  const candidate = details as Record<string, unknown>;
  if (candidate.direction === "outbound") {
    return null;
  }

  if (
    typeof candidate.userId !== "string" ||
    typeof candidate.username !== "string" ||
    typeof candidate.platform !== "string" ||
    typeof candidate.channelId !== "string" ||
    typeof candidate.messageId !== "string" ||
    typeof candidate.isDirect !== "boolean" ||
    typeof candidate.atSelf !== "boolean" ||
    typeof candidate.isReplyToBot !== "boolean"
  ) {
    return null;
  }

  const isDirect = candidate.isDirect;
  const username = candidate.username;

  return {
    direction: "inbound",
    timestamp: typeof candidate.timestamp === "number" ? candidate.timestamp : 0,
    userId: candidate.userId,
    username,
    nickname: typeof candidate.nickname === "string" ? candidate.nickname : username,
    identity:
      typeof candidate.identity === "string"
        ? candidate.identity
        : isDirect
          ? "direct-user"
          : "member",
    platform: candidate.platform,
    channelId: candidate.channelId,
    messageId: candidate.messageId,
    isDirect,
    atSelf: candidate.atSelf,
    isReplyToBot: candidate.isReplyToBot,
    replyTo: isReplyReference(candidate.replyTo) ? candidate.replyTo : undefined,
  };
}

function isReplyReference(value: unknown): value is ChannelEvent["replyTo"] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.username === "string" &&
    typeof candidate.nickname === "string" &&
    typeof candidate.summary === "string"
  );
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
    totalTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  finishReason?: string;
}): AgentAssistantMessage {
  const usageRecord = input.usage as Record<string, unknown> | undefined;
  const usage = createAgentUsage({
    inputTokens: input.usage?.inputTokens,
    outputTokens: input.usage?.outputTokens,
    totalTokens: input.usage?.totalTokens,
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
