import type { ModelMessage } from "@ai-sdk/provider-utils";
import type { LanguageModel, OnFinishEvent, PrepareStepResult, ToolSet } from "ai";
import { stepCountIs, ToolLoopAgent } from "ai";
import { Bot, Context } from "koishi";

import { renderInboundChannelMessage } from "../channel-message";
import { compact, prepareCompaction, shouldCompact } from "../compaction";
import { estimateContextTokens } from "../compaction/estimate";
import {
  buildSessionContext,
  type ChannelMessageDetails,
  type SessionManager,
} from "../session-manager";
import type { ChannelEvent, ResponseEndRecord } from "../types";
import { judgeWillingness } from "../willingness";
import { DefaultSessionResourceLoader } from "../resource-loader";
import { TurnFinalizer } from "./finalization/turn-finalizer";
import {
  buildGenerateInputForTest,
  getReliableInputTokens,
  hasCompletedSendMessageWithoutHeartbeat,
  ResponseStepProcessor,
} from "./response-step-processor";
import type {
  ChannelAgentTurnSettingsSnapshot,
  ChannelAgentOptions,
  CompactionRunResult,
  MergedFollowUpOpportunity,
  ResponseState,
} from "./types";
import { buildResponseToolSet } from "./workspace-tools";

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
  bot: Bot | undefined;
  readonly sessionManager: SessionManager;

  private options: ChannelAgentOptions;
  private responseState: ResponseState = "idle";
  private abortController: AbortController | null = null;
  private pendingFollowUp: MergedFollowUpOpportunity | null = null;
  private responseStartTime = 0;
  private stepsCompleted = 0;
  private responseToolSnapshot: ToolSet = {};
  private responseActiveTools: string[] = [];
  private currentTurnSettings: ChannelAgentTurnSettingsSnapshot | null = null;
  private readonly turnFinalizer = new TurnFinalizer();
  private readonly responseStepProcessor: ResponseStepProcessor;

  constructor(
    private ctx: Context,
    options: ChannelAgentOptions,
  ) {
    this.options = options;
    this.bot = options.bot;
    this.sessionManager = options.sessionManager;
    this.responseStepProcessor = new ResponseStepProcessor({
      sessionManager: this.sessionManager,
      platform: options.platform,
      channelId: options.channelId,
    });
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

  private createTurnSettingsSnapshot(): ChannelAgentTurnSettingsSnapshot {
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

  private getActiveTurnSettings(): ChannelAgentTurnSettingsSnapshot {
    return this.currentTurnSettings ?? this.createTurnSettingsSnapshot();
  }

  // =========================================================================
  // Agent Construction
  // =========================================================================

  private createAgent(turnSettings: ChannelAgentTurnSettingsSnapshot): ToolLoopAgent<never, ToolSet> {
    const model = this.ctx["yesimbot.model"].resolve(turnSettings.modelId);
    const cumulativeTimeoutMs =
      turnSettings.baseTimeoutMs + turnSettings.maxSteps * turnSettings.perStepTimeoutMs;
    return new ToolLoopAgent<never, ToolSet>({
      model,
      tools: {},
      stopWhen: [
        stepCountIs(turnSettings.maxSteps),
        ({ steps }) => hasCompletedSendMessageWithoutHeartbeat(steps),
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
    this.bindBot(event.bot);

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
    const selfId = event.bot?.selfId ?? this.bot?.selfId ?? "";
    const judgeSettings = this.options.settingsManager.getJudgeSettings();
    const willingness = await judgeWillingness(this.ctx, {
      isDirect: event.isDirect,
      atSelf: event.atSelf,
      isReplyToBot: event.isReplyToBot,
      content: event.content,
      selfId,
      senderId: event.userId,
      judgeEnabled: judgeSettings?.enabled,
      judgeModel: judgeSettings?.model,
      judgeTimeoutMs: judgeSettings?.timeoutMs,
    });

    if (!willingness.shouldRespond) {
      return;
    }

    if (this.hasActiveTurn()) {
      this.markPendingFollowUp(event.timestamp);
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
      this.responseState = "aborting";
      this.abortController.abort();
    }
  }

  /** Current response state. */
  getResponseState(): ResponseState {
    return this.responseState;
  }

  getSettingsManager(): ChannelAgentOptions["settingsManager"] {
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

  private markPendingFollowUp(observedAt: number): void {
    if (!this.pendingFollowUp) {
      this.pendingFollowUp = {
        pending: true,
        firstObservedAt: observedAt,
        latestObservedAt: observedAt,
      };
      return;
    }

    this.pendingFollowUp.latestObservedAt = observedAt;
    this.pendingFollowUp.pending = true;
  }

  private consumePendingFollowUp(): MergedFollowUpOpportunity | null {
    const pendingFollowUp = this.pendingFollowUp;
    this.pendingFollowUp = null;
    return pendingFollowUp;
  }

  private async runResponse(protocolRetry = false): Promise<void> {
    this.responseStepProcessor.beginResponse(protocolRetry);
    this.responseState = "responding";
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
      const resourceLoader = new DefaultSessionResourceLoader({
        channelDir: this.options.basePath,
        settingsManager: this.options.settingsManager,
        logger: this.ctx.logger("session"),
      });
      resourceLoader.reload();
      const instructions = resourceLoader.buildSystemPrompt();

      const { messages } = buildGenerateInputForTest({
        instructions,
        sessionEntries: [...this.sessionManager.getEntries()],
      });

      if (!this.bot) {
        throw new Error(`Channel bot unavailable for ${this.options.platform}:${this.options.channelId}`);
      }
      const bot = this.bot;

      const pluginTools = this.ctx["yesimbot.plugin"]?.getToolSet() ?? {};
      this.responseToolSnapshot = await buildResponseToolSet({
        bot,
        channelId: this.options.channelId,
        pluginTools,
        workspace: {
          basePath: this.options.basePath,
          settingsManager: this.options.settingsManager,
        },
      });
      this.responseActiveTools = Object.keys(this.responseToolSnapshot);

      const agent = this.createAgent(turnSettings);
      Object.assign(agent.tools, this.responseToolSnapshot);

      // Run agent
      if (turnSettings.streaming) {
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
        this.responseStepProcessor.setThrownError(err instanceof Error ? err.message : String(err));

        this.ctx.logger.error(
          `Response failed for ${this.options.platform}:${this.options.channelId}: ${this.responseStepProcessor.thrownError}`,
        );
      }
    } finally {
      clearTimeout(watchdog);

      if (this.responseStepProcessor.pendingProtocolRetry) {
        this.responseState = "idle";
        this.abortController = null;
        this.currentTurnSettings = null;
        this.runResponse(true).catch(() => {});
        return;
      }

      this.responseState = "finalizing";

      const endReason = this.turnFinalizer.resolveEndReason({
        aborted: this.abortController?.signal.aborted === true && !timedOut,
        timedOut,
        protocolError: this.responseStepProcessor.protocolError,
        heartbeatRequested: this.responseStepProcessor.heartbeatRequested,
        sendFailure: this.responseStepProcessor.sendFailure,
        thrownError: this.responseStepProcessor.thrownError,
      });
      const outcome = this.turnFinalizer.selectOutcome({
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
      this.turnFinalizer.persist(this.sessionManager, record);

      this.responseState = "ended";
      this.abortController = null;

      if (outcome.nextOutcome === "follow_up") {
        this.consumePendingFollowUp();
        this.responseState = "idle";
        this.currentTurnSettings = null;
        this.runResponse().catch(() => {});
        return;
      }

      this.pendingFollowUp = null;
      this.responseState = "idle";
      this.currentTurnSettings = null;
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
  private handleStepFinish(stepResult: Parameters<ResponseStepProcessor["apply"]>[0]): void {
    this.stepsCompleted++;
    this.responseStepProcessor.apply(stepResult);
  }

  private handleFinish(event: OnFinishEvent): void {
    const turnSettings = this.getActiveTurnSettings();
    const totalUsage = event.totalUsage ?? event.usage;
    const contextTokens =
      getReliableInputTokens(totalUsage) ??
      estimateContextTokens(
        buildSessionContext([...this.sessionManager.getEntries()]).agentMessages,
      );

    if (!shouldCompact(contextTokens, turnSettings.contextWindow, turnSettings.compactionSettings)) {
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
