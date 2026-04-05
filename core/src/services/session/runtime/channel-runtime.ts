import { env } from "node:process";

import type { ModelMessage } from "@ai-sdk/provider-utils";
import type { LanguageModel, OnFinishEvent, PrepareStepResult, ToolSet } from "ai";
import { stepCountIs, ToolLoopAgent } from "ai";
import { Bot, Context, Logger } from "koishi";

import { AgentSession } from "../agent-session";
import { compact, prepareCompaction, shouldCompact } from "../compaction";
import { estimateContextTokens } from "../compaction/estimate";
import { DefaultSessionResourceLoader } from "../resource-loader";
import type { SessionManager } from "../session-manager";
import { buildSessionContext } from "../session-manager";
import type {
  CanonicalChannelInput,
  CanonicalChannelMessageInput,
  ChannelEvent,
  FollowUpReviewRecord,
  ResponseEndReason,
  ResponseEndRecord,
} from "../types";
import {
  createDefaultWillingnessJudge,
  evaluateRuntimeWillingnessHeuristic,
  type WillingnessJudge,
} from "../willingness";
import {
  buildRuntimeModelMessages,
  getReliableInputTokens,
  hasCompletedSendMessageWithoutHeartbeat,
  PROTOCOL_GUIDANCE_TEXT,
  ResponseStepProcessor,
} from "./response-step-processor";
import type {
  ChannelRuntimeOptions,
  ChannelRuntimeTurnSettingsSnapshot,
  CompactionRunResult,
  MergedFollowUpOpportunity,
  ResponseState,
  RuntimeTurnExecutionOptions,
  RuntimeTurnExecutionResult,
  TurnOutcomeSelection,
} from "./types";
import { buildResponseToolSet } from "./workspace-tools";

// ============================================================================
// ChannelRuntime
// ============================================================================

/**
 * Per-channel runtime wrapping AI SDK ToolLoopAgent + SessionManager.
 *
 * Responsibilities:
 * - Receive incoming messages, persist them, check willingness
 * - Schedule and execute AI responses via ToolLoopAgent
 * - Persist AI response steps to SessionManager
 * - Manage concurrency (prevent parallel generate() calls per channel)
 */
export class ChannelRuntime {
  bot: Bot | undefined;
  readonly sessionManager: SessionManager;
  readonly session: AgentSession;

  private options: ChannelRuntimeOptions;
  private responseState: ResponseState = "idle";
  private abortController: AbortController | null = null;
  private pendingFollowUp: MergedFollowUpOpportunity | null = null;
  private responseStartTime = 0;
  private stepsCompleted = 0;
  private responseActiveTools: string[] = [];
  private currentTurnSettings: ChannelRuntimeTurnSettingsSnapshot | null = null;
  private currentTurnInstructions: string | null = null;
  private currentTurnFollowUpReview: FollowUpReviewRecord | null = null;
  private nextTurnFollowUpReview: FollowUpReviewRecord | null = null;
  private currentProtocolRetry = false;
  private cachedAgent: ToolLoopAgent<never, ToolSet> | null = null;
  private cachedAgentSignature: string | null = null;
  private readonly responseStepProcessor: ResponseStepProcessor;
  private readonly willingnessJudge: WillingnessJudge;
  private readonly logger: Logger;

  constructor(
    private ctx: Context,
    options: ChannelRuntimeOptions,
  ) {
    this.options = options;
    this.bot = options.bot;
    this.sessionManager = options.sessionManager;
    this.session = new AgentSession(this.sessionManager);
    this.logger = this.ctx.logger("session");
    this.logger.level = 3;
    this.willingnessJudge = options.willingnessJudge ?? createDefaultWillingnessJudge(this.ctx);
    this.responseStepProcessor = new ResponseStepProcessor({
      session: this.session,
      platform: options.platform,
      channelId: options.channelId,
      logger: this.logger,
    });
  }

  private getChannelKey(): string {
    return `${this.options.platform}:${this.options.channelId}`;
  }

  private setResponseState(nextState: ResponseState, reason: string): void {
    const prevState = this.responseState;
    if (prevState === nextState) {
      this.logger.debug(`[state:${this.getChannelKey()}] ${nextState} reason=${reason}`);
      return;
    }

    this.responseState = nextState;
    this.logger.debug(
      `[state:${this.getChannelKey()}] ${prevState}->${nextState} reason=${reason}`,
    );
  }

  private getModelId(): string {
    const modelId = this.options.settingsManager.getModel();
    if (!modelId) {
      throw new Error(
        `Channel model unavailable for ${this.options.platform}:${this.options.channelId}`,
      );
    }
    return modelId;
  }

  private createTurnSettingsSnapshot(): ChannelRuntimeTurnSettingsSnapshot {
    const responseSettings = this.options.settingsManager.getResponseSettings();
    const compactionSettings = this.options.settingsManager.getCompactionSettings();

    return {
      modelId: this.getModelId(),
      streaming: responseSettings?.streaming ?? false,
      maxSteps: responseSettings?.maxSteps ?? 20,
      baseTimeoutMs: responseSettings?.baseTimeoutMs ?? 60000,
      perStepTimeoutMs: responseSettings?.perStepTimeoutMs ?? 30000,
      chunkTimeoutMs: responseSettings?.chunkTimeoutMs ?? 10000,
      contextWindow: compactionSettings?.contextWindow ?? 128000,
      compactionSettings: {
        enabled: compactionSettings?.enabled ?? true,
        reserveTokens: compactionSettings?.reserveTokens ?? 16384,
        keepRecentTokens: compactionSettings?.keepRecentTokens ?? 20000,
        model: compactionSettings?.model,
      },
    };
  }

  private getActiveTurnSettings(): ChannelRuntimeTurnSettingsSnapshot {
    return this.currentTurnSettings ?? this.createTurnSettingsSnapshot();
  }

  private appendAssistantMessage(
    record: Parameters<AgentSession["appendAssistantMessage"]>[0],
  ): string {
    return this.session.appendAssistantMessage(record);
  }

  private appendToolMessage(record: Parameters<AgentSession["appendToolMessage"]>[0]): string {
    return this.session.appendToolMessage(record);
  }

  // =========================================================================
  // Agent Construction
  // =========================================================================

  private createAgent(
    turnSettings: ChannelRuntimeTurnSettingsSnapshot,
  ): ToolLoopAgent<never, ToolSet> {
    const model = this.ctx["yesimbot.model"].resolve(turnSettings.modelId);
    const cumulativeTimeoutMs =
      turnSettings.baseTimeoutMs + turnSettings.maxSteps * turnSettings.perStepTimeoutMs;
    return new ToolLoopAgent<never, ToolSet>({
      model,
      tools: {},
      stopWhen: [
        stepCountIs(turnSettings.maxSteps),
        ({ steps }) =>
          hasCompletedSendMessageWithoutHeartbeat(steps) ||
          this.responseStepProcessor.completedSendMessageWithoutHeartbeat,
      ],
      timeout: {
        totalMs: cumulativeTimeoutMs,
        chunkMs: turnSettings.chunkTimeoutMs,
      },
      prepareStep: this.handlePrepareStep.bind(this),
      onStepFinish: this.handleStepFinish.bind(this),
      onFinish: this.handleFinish.bind(this),
    });
  }

  private getAgentSignature(turnSettings: ChannelRuntimeTurnSettingsSnapshot): string {
    return [
      turnSettings.modelId,
      turnSettings.maxSteps,
      turnSettings.baseTimeoutMs,
      turnSettings.perStepTimeoutMs,
      turnSettings.chunkTimeoutMs,
    ].join(":");
  }

  private getOrCreateAgent(
    turnSettings: ChannelRuntimeTurnSettingsSnapshot,
  ): ToolLoopAgent<never, ToolSet> {
    const nextSignature = this.getAgentSignature(turnSettings);
    if (this.cachedAgent && this.cachedAgentSignature === nextSignature) {
      return this.cachedAgent;
    }

    const agent = this.createAgent(turnSettings);
    this.cachedAgent = agent;
    this.cachedAgentSignature = nextSignature;
    return agent;
  }

  private syncAgentTools(agent: ToolLoopAgent<never, ToolSet>, nextTools: ToolSet): void {
    for (const toolName of Object.keys(agent.tools)) {
      Reflect.deleteProperty(agent.tools, toolName);
    }

    Object.assign(agent.tools, nextTools);
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Process an incoming channel message input.
   *
   * 1. Persist the canonical message to the timeline immediately
   * 2. Run willingness check
   * 3. If should respond, schedule a response
   */
  async receive(input: CanonicalChannelInput | ChannelEvent): Promise<void> {
    const event = normalizeChannelRuntimeInput(input);

    this.logger.debug(
      `[input:${this.getChannelKey()}] user=${event.sender.userId} direct=${event.isDirect} atSelf=${event.atSelf} replyToBot=${event.isReplyToBot} messageId=${event.messageId}`,
    );

    this.session.appendChannelMessage({
      id: event.messageId || createRuntimeRecordId(),
      timestamp: event.timestamp,
      stage: "ingress",
      visibility: "model",
      materialization: "default",
      message: event,
    });

    // 2. Willingness check
    const selfId = this.bot?.selfId ?? "";
    const judgeSettings = this.options.settingsManager.getJudgeSettings();
    const heuristic = evaluateRuntimeWillingnessHeuristic({
      isDirect: event.isDirect,
      atSelf: event.atSelf,
      isReplyToBot: event.isReplyToBot,
      selfId,
      senderId: event.sender.userId,
    });
    const willingness =
      heuristic ??
      (await this.willingnessJudge.judge({
        isDirect: event.isDirect,
        atSelf: event.atSelf,
        isReplyToBot: event.isReplyToBot,
        content: event.content,
        selfId,
        senderId: event.sender.userId,
        judgeEnabled: judgeSettings?.enabled,
        judgeModel: judgeSettings?.model,
        judgeTimeoutMs: judgeSettings?.timeoutMs,
      }));

    this.logger.debug(
      `[willingness:${this.getChannelKey()}] shouldRespond=${willingness.shouldRespond} reason=${willingness.reason} source=${heuristic ? "heuristic" : "judge"}`,
    );

    if (!willingness.shouldRespond) {
      return;
    }

    if (this.hasActiveTurn()) {
      this.markPendingFollowUp({
        observedAt: event.timestamp,
        messageId: event.messageId,
      });
      return;
    }

    // 3. Schedule response
    this.scheduleResponse();
  }

  bindBot(bot?: Bot): void {
    if (bot) {
      this.bot = bot;
    }
  }

  /** Abort the current response if one is in progress. */
  abort(): void {
    if (this.abortController && this.responseState === "responding") {
      this.setResponseState("aborting", "abort_requested");
      this.abortController.abort();
    }
  }

  /** Current response state. */
  getResponseState(): ResponseState {
    return this.responseState;
  }

  getSettingsManager(): ChannelRuntimeOptions["settingsManager"] {
    return this.options.settingsManager;
  }

  // =========================================================================
  // Response Scheduling
  // =========================================================================

  private scheduleResponse(): void {
    if (this.hasActiveTurn()) {
      return;
    }

    this.runResponse().catch(() => {});
  }

  private hasActiveTurn(): boolean {
    return (
      this.responseState === "responding" ||
      this.responseState === "aborting" ||
      this.responseState === "finalizing"
    );
  }

  private markPendingFollowUp(input: { observedAt: number; messageId: string }): void {
    if (!this.pendingFollowUp) {
      this.pendingFollowUp = {
        pending: true,
        firstObservedAt: input.observedAt,
        latestObservedAt: input.observedAt,
        messageCount: 1,
        messageIds: [input.messageId],
      };
      this.logger.debug(`[state:${this.getChannelKey()}] pending_follow_up observed`);
      return;
    }

    this.pendingFollowUp.latestObservedAt = input.observedAt;
    this.pendingFollowUp.pending = true;
    if (!this.pendingFollowUp.messageIds.includes(input.messageId)) {
      this.pendingFollowUp.messageIds.push(input.messageId);
      this.pendingFollowUp.messageCount = this.pendingFollowUp.messageIds.length;
    }
    this.logger.debug(`[state:${this.getChannelKey()}] pending_follow_up updated`);
  }

  private consumePendingFollowUp(): MergedFollowUpOpportunity | null {
    const pendingFollowUp = this.pendingFollowUp;
    this.pendingFollowUp = null;
    return pendingFollowUp;
  }

  private buildRuntimeMessages(instructions: string, protocolRetry: boolean): ModelMessage[] {
    return buildRuntimeModelMessages(this.session, instructions, {
      followUpReview: this.currentTurnFollowUpReview?.content,
      protocolRetry,
    });
  }

  private createFollowUpReviewRecord(
    pendingFollowUp: MergedFollowUpOpportunity,
  ): FollowUpReviewRecord {
    const firstObservedIso = new Date(pendingFollowUp.firstObservedAt).toISOString();
    const latestObservedIso = new Date(pendingFollowUp.latestObservedAt).toISOString();
    const observedWindow =
      pendingFollowUp.firstObservedAt === pendingFollowUp.latestObservedAt
        ? firstObservedIso
        : `${firstObservedIso} -> ${latestObservedIso}`;
    const messageLabel = pendingFollowUp.messageCount === 1 ? "message" : "messages";
    const trackedMessageIds =
      pendingFollowUp.messageIds.length > 0
        ? pendingFollowUp.messageIds.join(", ")
        : "unknown";
    const content = [
      "[Follow-up Review]",
      `While you were responding, ${pendingFollowUp.messageCount} new channel ${messageLabel} arrived during ${observedWindow}.`,
      `Review the recent channel_message entries from that window before deciding what to do next. Tracked messageIds: ${trackedMessageIds}.`,
      "Some of those messages may already have been handled during earlier response rounds. If a message is already handled, skip it. Otherwise reply or take the necessary action now.",
    ].join("\n");

    return {
      content,
      firstObservedAt: pendingFollowUp.firstObservedAt,
      latestObservedAt: pendingFollowUp.latestObservedAt,
      messageCount: pendingFollowUp.messageCount,
      messageIds: [...pendingFollowUp.messageIds],
    };
  }

  private async executeRuntimeTurn(
    options: RuntimeTurnExecutionOptions,
  ): Promise<RuntimeTurnExecutionResult> {
    const channelKey = `${options.platform}:${options.channelId}`;
    const resourceLoader = new DefaultSessionResourceLoader({
      channelDir: options.basePath,
      settingsManager: options.settingsManager,
      logger: options.logger,
    });
    resourceLoader.reload();

    const instructions = resourceLoader.buildSystemPrompt();
    this.currentTurnInstructions = instructions;
    this.currentProtocolRetry = options.protocolRetry;
    const modelMessages = this.buildRuntimeMessages(instructions, options.protocolRetry);

    const pluginTools = options.ctx["yesimbot.plugin"]?.getToolSet() ?? {};
    const responseToolSnapshot = await buildResponseToolSet({
      bot: options.bot,
      channelId: options.channelId,
      pluginTools,
      workspace: {
        basePath: options.basePath,
        settingsManager: options.settingsManager,
        logger: options.logger,
      },
    });
    const responseActiveTools = Object.keys(responseToolSnapshot);
    this.responseActiveTools = responseActiveTools;

    const agent = this.getOrCreateAgent(options.turnSettings);
    this.syncAgentTools(agent, responseToolSnapshot);

    options.logger.debug(
      `[llm:${channelKey}] start streaming=${options.turnSettings.streaming} messages=${modelMessages.length} tools=${responseActiveTools.length} retry=${options.protocolRetry}`,
    );

    if (options.turnSettings.streaming) {
      const result = await abortable(options.abortSignal, () =>
        agent.stream({
          messages: modelMessages,
          abortSignal: options.abortSignal,
        }),
      );
      await abortable(options.abortSignal, () => result.consumeStream());
    } else {
      await abortable(options.abortSignal, () =>
        agent.generate({
          messages: modelMessages,
          abortSignal: options.abortSignal,
        }),
      );
    }

    options.logger.debug(`[llm:${channelKey}] end`);

    return {
      responseActiveTools,
    };
  }

  private async runResponse(protocolRetry = false): Promise<void> {
    if (!protocolRetry) {
      this.currentTurnFollowUpReview = this.nextTurnFollowUpReview;
      this.nextTurnFollowUpReview = null;
    }

    this.responseStepProcessor.beginResponse(protocolRetry);
    this.setResponseState("responding", protocolRetry ? "protocol_retry" : "response_start");
    this.abortController = new AbortController();
    this.responseStartTime = Date.now();
    this.stepsCompleted = 0;
    this.currentTurnSettings = this.createTurnSettingsSnapshot();

    const turnSettings = this.currentTurnSettings;
    const timeoutMs =
      turnSettings.baseTimeoutMs + turnSettings.maxSteps * turnSettings.perStepTimeoutMs;
    let timedOut = false;

    const watchdog = setTimeout(() => {
      if (this.responseState === "responding") {
        timedOut = true;
        this.abortController?.abort();
      }
    }, timeoutMs);

    try {
      if (!this.bot) {
        throw new Error(
          `Channel bot unavailable for ${this.options.platform}:${this.options.channelId}`,
        );
      }

      const executionResult = await this.executeRuntimeTurn({
        ctx: this.ctx,
        logger: this.logger,
        bot: this.bot,
        sessionManager: this.sessionManager,
        settingsManager: this.options.settingsManager,
        platform: this.options.platform,
        channelId: this.options.channelId,
        basePath: this.options.basePath,
        turnSettings,
        protocolRetry,
        abortSignal: this.abortController.signal,
      });
      this.responseActiveTools = executionResult.responseActiveTools;
    } catch (err: unknown) {
      if (!this.abortController?.signal.aborted) {
        this.responseStepProcessor.setThrownError(err instanceof Error ? err.message : String(err));

        this.ctx.logger.error(
          `Response failed for ${this.options.platform}:${this.options.channelId}: ${this.responseStepProcessor.thrownError}`,
        );
      }
    } finally {
      clearTimeout(watchdog);

      if (this.responseStepProcessor.pendingProtocolRetry) {
        this.setResponseState("idle", "protocol_retry_pending");
        this.abortController = null;
        this.currentTurnSettings = null;
        this.currentTurnInstructions = null;
        this.currentProtocolRetry = false;
        this.runResponse(true).catch(() => {});
        return;
      }

      this.setResponseState("finalizing", "response_end");
      function resolveEndReason(input: {
        aborted: boolean;
        timedOut: boolean;
        protocolError: boolean;
        heartbeatRequested: boolean;
        sendFailure: boolean;
        thrownError?: string;
      }): ResponseEndReason {
        if (input.timedOut) {
          return "timeout";
        }

        if (input.aborted) {
          return "abort";
        }

        if (input.protocolError) {
          return "protocol_error";
        }

        if (input.sendFailure || Boolean(input.thrownError)) {
          return "exception";
        }

        if (input.heartbeatRequested) {
          return "heartbeat_continuation";
        }

        return "normal";
      }
      const endReason = resolveEndReason({
        aborted: this.abortController?.signal.aborted === true && !timedOut,
        timedOut,
        protocolError: this.responseStepProcessor.protocolError,
        heartbeatRequested: this.responseStepProcessor.heartbeatRequested,
        sendFailure: this.responseStepProcessor.sendFailure,
        thrownError: this.responseStepProcessor.thrownError,
      });

      function selectOutcome(input: {
        endReason: ResponseEndReason;
        hasPendingFollowUp: boolean;
        thrownError?: string;
      }): TurnOutcomeSelection {
        if (
          input.endReason === "timeout" ||
          input.endReason === "protocol_error" ||
          input.endReason === "exception"
        ) {
          return {
            nextOutcome: "blocked",
            blockedReason: input.thrownError ?? input.endReason,
          };
        }

        if (input.hasPendingFollowUp) {
          return { nextOutcome: "follow_up" };
        }

        return { nextOutcome: "idle" };
      }
      const outcome = selectOutcome({
        endReason,
        hasPendingFollowUp: Boolean(this.pendingFollowUp?.pending),
        thrownError: this.responseStepProcessor.thrownError,
      });
      const record: ResponseEndRecord = {
        endReason,
        nextOutcome: outcome.nextOutcome,
        durationMs: Date.now() - this.responseStartTime,
        stepsCompleted: this.stepsCompleted,
        error: this.responseStepProcessor.thrownError,
        blockedReason: outcome.blockedReason,
      };
      this.sessionManager.appendCustomEntry<ResponseEndRecord>("response_end", record);
      this.logger.debug(
        `[state:${this.getChannelKey()}] end reason=${endReason} outcome=${outcome.nextOutcome} steps=${this.stepsCompleted} durationMs=${record.durationMs}`,
      );

      this.setResponseState("ended", "record_persisted");
      this.abortController = null;

      if (outcome.nextOutcome === "follow_up") {
        const pendingFollowUp = this.consumePendingFollowUp();
        if (pendingFollowUp) {
          const followUpReview = this.createFollowUpReviewRecord(pendingFollowUp);
          this.sessionManager.appendCustomEntry<FollowUpReviewRecord>(
            "follow_up_review",
            followUpReview,
          );
          this.nextTurnFollowUpReview = followUpReview;
        }
        this.setResponseState("idle", "follow_up");
        this.currentTurnSettings = null;
        this.currentTurnInstructions = null;
        this.currentTurnFollowUpReview = null;
        this.currentProtocolRetry = false;
        this.runResponse().catch(() => {});
        return;
      }

      this.pendingFollowUp = null;
      this.setResponseState("idle", "response_complete");
      this.currentTurnSettings = null;
      this.currentTurnInstructions = null;
      this.currentTurnFollowUpReview = null;
      this.currentProtocolRetry = false;
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
    const nextMessages = this.currentTurnInstructions
      ? this.buildRuntimeMessages(this.currentTurnInstructions, this.currentProtocolRetry)
      : _opts.messages;
    const maxTokenEstimate = 100000;
    const estimatedTokens = JSON.stringify(nextMessages).length / 4;

    if (estimatedTokens > maxTokenEstimate) {
      const [system, ...rest] = nextMessages;
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
      messages: nextMessages,
    };
  }

  /**
   * Called after each LLM step. Persists messages and enforces tool-first outbound protocol.
   */
  private handleStepFinish(stepResult: Parameters<ResponseStepProcessor["apply"]>[0]): void {
    this.stepsCompleted++;
    this.responseStepProcessor.apply(stepResult);
    this.logger.debug(
      `[step:${this.getChannelKey()}] completed count=${this.stepsCompleted} finishReason=${stepResult.finishReason ?? "unknown"}`,
    );
  }

  private handleFinish(event: OnFinishEvent): void {
    const turnSettings = this.getActiveTurnSettings();
    const totalUsage = event.totalUsage ?? event.usage;
    const contextTokens =
      getReliableInputTokens(totalUsage) ??
      estimateContextTokens(
        buildSessionContext([...this.sessionManager.getEntries()]).agentMessages,
      );

    if (
      !shouldCompact(contextTokens, turnSettings.contextWindow, turnSettings.compactionSettings)
    ) {
      return;
    }

    this.runCompaction(contextTokens, turnSettings).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.ctx.logger.error(
        `Compaction failed for ${this.options.platform}:${this.options.channelId}: ${msg}`,
      );
    });
  }

  public async runCompaction(
    contextTokens: number,
    turnSettings = this.createTurnSettingsSnapshot(),
  ): Promise<CompactionRunResult> {
    const entries = [...this.sessionManager.getEntries()];
    if (entries.length === 0) {
      return { compacted: false, reason: "empty-session" };
    }

    if (entries[entries.length - 1]?.type === "compaction") {
      return { compacted: false, reason: "already-compacted" };
    }

    const preparation = prepareCompaction(entries, turnSettings.compactionSettings, contextTokens);
    if (!preparation) {
      return { compacted: false, reason: "nothing-to-compact" };
    }

    const compactionModelId = turnSettings.compactionSettings.model ?? turnSettings.modelId;
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
}

async function abortable<T>(signal: AbortSignal, operation: () => PromiseLike<T>): Promise<T> {
  if (signal.aborted) {
    throw new Error("aborted");
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error("aborted"));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    operation().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function normalizeChannelRuntimeInput(
  input: CanonicalChannelInput | ChannelEvent,
): CanonicalChannelMessageInput {
  if ("kind" in input) {
    if (input.kind !== "channel_message") {
      throw new Error(`Unsupported canonical input kind for runtime receive: ${input.kind}`);
    }

    return input;
  }

  return {
    kind: "channel_message",
    platform: input.platform,
    channelId: input.channelId,
    messageId: input.messageId,
    timestamp: input.timestamp,
    content: input.content,
    sender: {
      userId: input.userId,
      username: input.username,
      nickname: input.nickname,
      identity: input.identity,
    },
    isDirect: input.isDirect,
    atSelf: input.atSelf,
    isReplyToBot: input.isReplyToBot,
    replyTo: input.replyTo,
  };
}

function createRuntimeRecordId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}
