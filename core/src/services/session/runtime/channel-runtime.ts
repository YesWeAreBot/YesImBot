import { dirname } from "node:path";

import type { ModelMessage } from "@ai-sdk/provider-utils";
import type { IPluginService, ToolCatalog, ToolSelection } from "@yesimbot/plugin-sdk";
import type { LanguageModel, OnFinishEvent, PrepareStepResult, ToolSet } from "ai";
import { stepCountIs, ToolLoopAgent } from "ai";
import { Bot, Context, Logger } from "koishi";

import { AgentSession } from "../agent-session";
import { compact, prepareCompaction, shouldCompact } from "../compaction";
import { estimateContextTokens } from "../compaction/estimate";
import { InstructionAssembler } from "../instruction-assembler";
import { InstructionStateService } from "../instruction-state/service";
import type { SessionManager } from "../session-manager";
import type {
  FollowUpReviewRecord,
  ResponseStatusNoticeSubType,
  ResponseStatusReason,
  ResponseStatusRecord,
} from "../types";
import type { ChannelInput, ChannelMessageInput, TimelineRecord } from "../types/index";
import {
  createDefaultWillingnessJudge,
  evaluateRuntimeWillingnessHeuristic,
  type WillingnessJudge,
} from "../willingness";
import { prepareRuntimeModel } from "./model-adapter";
import {
  buildRuntimeModelMessages,
  getReliableInputTokens,
  hasCompletedSendMessageWithoutHeartbeat,
  ResponseStepProcessor,
} from "./response-step-processor";
import { createSendMessageTool } from "./send-message-tool";
import type {
  ChannelRuntimeOptions,
  ChannelRuntimeTurnSettingsSnapshot,
  CompactionRunResult,
  MergedFollowUpOpportunity,
  NextActionSelection,
  ResponseState,
  RuntimeTurnExecutionOptions,
  RuntimeTurnExecutionResult,
} from "./types";

// ============================================================================
// ChannelRuntime
// ============================================================================

type ResponseHostInput = {
  triggerEvents: ChannelInput[];
  responderId: string;
  channelId: string;
  platform: string;
  startedAt: number;
};

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
  private cachedPreparedModel: ReturnType<typeof prepareRuntimeModel> | null = null;
  private cachedPreparedModelSignature: string | null = null;
  public currentSupportedToolSignature: string | null = null;
  private currentToolCatalog: ToolCatalog | null = null;
  private currentToolSelection: ToolSelection | null = null;
  private pendingResponseInputs: ChannelInput[] = [];
  private currentResponseContext: unknown;
  private currentToolExperimentalContext: unknown;
  private readonly responseStepProcessor: ResponseStepProcessor;
  private readonly willingnessJudge: WillingnessJudge;
  private readonly logger: Logger;
  private readonly instructionAssembler: InstructionAssembler;

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
    const instructionStateService =
      options.instructionStateService ?? new InstructionStateService(dirname(options.basePath));
    this.instructionAssembler = new InstructionAssembler({
      instructionStateService,
      getBuiltInInstructions: (fallback) =>
        options.settingsManager.getBuiltInInstructions(fallback) ?? fallback,
      contributors: options.instructionContributors,
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
    model: LanguageModel,
  ): ToolLoopAgent<never, ToolSet> {
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
      prepareCall: async (options) => ({
        ...options,
        experimental_context: this.currentToolExperimentalContext,
      }),
      prepareStep: this.handlePrepareStep.bind(this),
      onStepFinish: this.handleStepFinish.bind(this),
      onFinish: this.handleFinish.bind(this),
    });
  }

  private getAgentSignature(
    turnSettings: ChannelRuntimeTurnSettingsSnapshot,
    modelMode: string,
  ): string {
    return [
      turnSettings.modelId,
      modelMode,
      turnSettings.maxSteps,
      turnSettings.baseTimeoutMs,
      turnSettings.perStepTimeoutMs,
      turnSettings.chunkTimeoutMs,
    ].join(":");
  }

  private getOrCreateAgent(
    turnSettings: ChannelRuntimeTurnSettingsSnapshot,
    model: LanguageModel,
    modelMode: string,
  ): ToolLoopAgent<never, ToolSet> {
    const nextSignature = this.getAgentSignature(turnSettings, modelMode);
    if (this.cachedAgent && this.cachedAgentSignature === nextSignature) {
      return this.cachedAgent;
    }

    const agent = this.createAgent(turnSettings, model);
    this.cachedAgent = agent;
    this.cachedAgentSignature = nextSignature;
    this.currentSupportedToolSignature = null;
    return agent;
  }

  private syncAgentTools(agent: ToolLoopAgent<never, ToolSet>, nextTools: ToolSet): void {
    for (const toolName of Object.keys(agent.tools)) {
      Reflect.deleteProperty(agent.tools, toolName);
    }

    Object.assign(agent.tools, nextTools);
  }

  private getPreparedModel(
    turnSettings: ChannelRuntimeTurnSettingsSnapshot,
    requiresTools: boolean,
  ): ReturnType<typeof prepareRuntimeModel> {
    const nextSignature = this.getAgentSignature(
      turnSettings,
      requiresTools ? "tools-requested" : "plain",
    );
    if (this.cachedPreparedModel && this.cachedPreparedModelSignature === nextSignature) {
      return this.cachedPreparedModel;
    }

    const preparedModel = prepareRuntimeModel({
      registry: this.ctx["yesimbot.model"],
      modelId: turnSettings.modelId,
      requiresTools,
      requiresReasoning: false,
    });

    this.cachedPreparedModel = preparedModel;
    this.cachedPreparedModelSignature = nextSignature;
    return preparedModel;
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
  async receive(input: ChannelInput): Promise<void> {
    if (input.kind !== "channel_message") {
      throw new Error(`Unsupported channel input kind for runtime receive: ${input.kind}`);
    }

    this.appendInboundMessage(input);
    const shouldRespond = await this.shouldRespondNow(input);
    this.receiveWriteback(input, shouldRespond);
  }

  private appendInboundMessage(event: ChannelMessageInput): void {
    // receive
    // Always append the canonical channel_message before making turn decisions.
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
  }

  private async shouldRespondNow(event: ChannelMessageInput): Promise<boolean> {
    // shouldRespond
    // Decide after the inbound message has already become canonical session truth.
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

    return willingness.shouldRespond;
  }

  private receiveWriteback(event: ChannelMessageInput, shouldRespond: boolean): void {
    // writeback
    // Fan the receive-stage decision into immediate idle, a queued follow-up, or a new run.
    if (!shouldRespond) {
      return;
    }

    this.pendingResponseInputs.push(event);

    if (this.hasActiveTurn()) {
      this.markPendingFollowUp({
        observedAt: event.timestamp,
        messageId: event.messageId,
      });
      return;
    }

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
    return this.responseState === "responding";
  }

  private appendResponseStatus(record: ResponseStatusRecord): void {
    const subType = getResponseStatusNoticeSubType(record.endReason);
    this.session.appendSystemNotice({
      id: createRuntimeRecordId(),
      timestamp: Date.now(),
      stage: "runtime",
      visibility: "hidden",
      materialization: "hidden",
      subType,
      materializationKey: "response_status",
      notice: buildResponseStatusNotice(subType, record),
      data: record,
    });
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

  private getLatestChannelMessageInput(): ChannelMessageInput | undefined {
    const timeline = this.session.getTimeline();
    for (let i = timeline.length - 1; i >= 0; i--) {
      const record = timeline[i];
      if (record?.kind === "channel_message") {
        return record.message;
      }
    }

    return undefined;
  }

  private createToolRuntime(
    turnSettings: ChannelRuntimeTurnSettingsSnapshot,
    latestInput: ChannelMessageInput | undefined,
  ) {
    return {
      channelKey: this.getChannelKey(),
      platform: this.options.platform,
      channelId: this.options.channelId,
      modelId: turnSettings.modelId,
      basePath: this.options.basePath,
      turn: {
        messageId: latestInput?.messageId ?? createRuntimeRecordId(),
        timestamp: latestInput?.timestamp ?? Date.now(),
        isDirect: latestInput?.isDirect ?? false,
        atSelf: latestInput?.atSelf ?? false,
        isReplyToBot: latestInput?.isReplyToBot ?? false,
      },
    };
  }

  private getToolScope(): string | undefined {
    return this.getChannelKey();
  }

  private buildResponseHostInput(): ResponseHostInput {
    return {
      triggerEvents: [...this.pendingResponseInputs],
      responderId: (this.bot as { userId?: string } | undefined)?.userId ?? this.bot?.selfId ?? "",
      channelId: this.options.channelId,
      platform: this.options.platform,
      startedAt: Date.now(),
    };
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
      pendingFollowUp.messageIds.length > 0 ? pendingFollowUp.messageIds.join(", ") : "unknown";
    const content = [
      "[Follow-up Review]",
      `While you were responding, ${pendingFollowUp.messageCount} new channel ${messageLabel} arrived.`,
      `Observed window: ${observedWindow}.`,
      `Tracked message IDs: ${trackedMessageIds}.`,
      "Review the recent channel_message entries from that window before deciding what to do next.",
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
    const latestInput = this.getLatestChannelMessageInput();
    const instructions = await this.instructionAssembler.buildSystemPrompt({
      platform: options.platform,
      channelId: options.channelId,
      turn: latestInput ?? {
        kind: "channel_message",
        platform: options.platform,
        channelId: options.channelId,
        messageId: createRuntimeRecordId(),
        timestamp: Date.now(),
        content: "",
        sender: {
          userId: "unknown-user",
          username: "unknown-user",
        },
        isDirect: false,
        atSelf: false,
        isReplyToBot: false,
      },
    });
    this.currentTurnInstructions = instructions;
    this.currentProtocolRetry = options.protocolRetry;
    const modelMessages = this.buildRuntimeMessages(instructions, options.protocolRetry);

    const sendMessageTool = createSendMessageTool({
      bot: options.bot,
      channelId: options.channelId,
    });
    const pluginService = options.ctx["yesimbot.plugin"] as IPluginService | undefined;
    const runtime = this.createToolRuntime(options.turnSettings, latestInput);
    const responseHostInput = this.buildResponseHostInput();
    if (responseHostInput.triggerEvents.length === 0 && latestInput) {
      responseHostInput.triggerEvents = [latestInput];
    }
    this.pendingResponseInputs = [];
    const toolLifecycle = pluginService?.compileTools
      ? await (async () => {
          if (!this.currentToolCatalog) {
            this.currentToolCatalog = await pluginService.compileTools({
              runtime,
              scope: this.getToolScope(),
              hostInput: responseHostInput,
              sendMessageTool,
            });
          }

          const catalog = this.currentToolCatalog;
          const responseContext = await pluginService.buildResponseContext({
            runtime,
            scope: this.getToolScope(),
            hostInput: responseHostInput,
            catalog,
          });
          const toolSelection = await pluginService.selectTools({
            runtime,
            scope: this.getToolScope(),
            catalog,
            responseContext,
          });
          this.currentToolSelection = toolSelection;

          return {
            supportedTools: catalog.tools,
            activeTools: toolSelection.activeTools,
            responseContext: toolSelection.responseContext,
            signature: catalog.signature,
          };
        })()
      : (() => {
          this.currentToolSelection = null;
          options.logger.warn(
            `[tools:${channelKey}] PluginService unavailable; continuing with send_message only`,
          );

          return {
            supportedTools: { send_message: sendMessageTool },
            activeTools: { send_message: sendMessageTool },
            responseContext: {},
            signature: "no-plugin-service",
          };
        })();
    const responseActiveTools =
      this.currentToolSelection?.activeToolNames ?? Object.keys(toolLifecycle.activeTools);
    this.responseActiveTools = responseActiveTools;
    this.currentResponseContext = toolLifecycle.responseContext;
    this.currentToolExperimentalContext = this.currentResponseContext;

    const preparedModel = this.getPreparedModel(
      options.turnSettings,
      responseActiveTools.length > 0,
    );
    const modelMode =
      responseActiveTools.length > 0 && preparedModel.entry.toolCall === false
        ? "tool-compat"
        : "raw";

    const agent = this.getOrCreateAgent(options.turnSettings, preparedModel.model, modelMode);
    if (this.currentSupportedToolSignature !== toolLifecycle.signature) {
      this.syncAgentTools(agent, toolLifecycle.supportedTools);
      this.currentSupportedToolSignature = toolLifecycle.signature;
    }

    options.logger.debug(
      `[llm:${channelKey}] start streaming=${options.turnSettings.streaming} messages=${modelMessages.length} tools=${responseActiveTools.length} retry=${options.protocolRetry}`,
    );

    if (options.turnSettings.streaming) {
      let streamError: unknown;
      const captureStreamError = (error: unknown) => {
        if (streamError === undefined) {
          streamError = error;
        }
      };
      const result = await abortable(options.abortSignal, () =>
        agent.stream({
          messages: modelMessages,
          abortSignal: options.abortSignal,
        }),
      );
      await abortable(options.abortSignal, () =>
        result.consumeStream({
          onError: (error) => {
            captureStreamError(error);
          },
        }),
      );
      if (streamError !== undefined) {
        throw streamError;
      }
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
      const thrownError = err instanceof Error ? err.message : String(err);
      this.responseStepProcessor.setThrownError(thrownError);

      this.ctx.logger.error(
        `Response failed for ${this.options.platform}:${this.options.channelId}: ${this.responseStepProcessor.thrownError}`,
      );
    } finally {
      clearTimeout(watchdog);

      if (this.responseStepProcessor.pendingProtocolRetry) {
        this.setResponseState("idle", "protocol_retry_pending");
        this.abortController = null;
        this.currentTurnSettings = null;
        this.currentTurnInstructions = null;
        this.currentResponseContext = undefined;
        this.currentToolExperimentalContext = undefined;
        this.currentProtocolRetry = false;
        this.runResponse(true).catch(() => {});
        return;
      }

      // maybe follow-up
      function resolveEndReason(input: {
        aborted: boolean;
        timedOut: boolean;
        protocolError: boolean;
        heartbeatRequested: boolean;
        sendFailure: boolean;
        thrownError?: string;
      }): ResponseStatusReason {
        if (
          (input.sendFailure || Boolean(input.thrownError)) &&
          input.thrownError &&
          !isAbortLikeThrownError(input.thrownError) &&
          !isTimeoutLikeThrownError(input.thrownError)
        ) {
          return "exception";
        }

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
        endReason: ResponseStatusReason;
        hasPendingFollowUp: boolean;
        thrownError?: string;
      }): NextActionSelection {
        if (input.endReason === "timeout") {
          return {
            nextAction: "blocked",
            blockedReason: "timeout",
          };
        }

        if (input.endReason === "protocol_error" || input.endReason === "exception") {
          return {
            nextAction: "blocked",
            blockedReason: input.thrownError ?? input.endReason,
          };
        }

        if (
          input.endReason === "abort" &&
          input.thrownError &&
          !isAbortLikeThrownError(input.thrownError)
        ) {
          return {
            nextAction: "blocked",
            blockedReason: input.thrownError,
          };
        }

        if (input.hasPendingFollowUp) {
          return { nextAction: "follow_up" };
        }

        return { nextAction: "idle" };
      }
      const outcome = selectOutcome({
        endReason,
        hasPendingFollowUp: Boolean(this.pendingFollowUp?.pending),
        thrownError: this.responseStepProcessor.thrownError,
      });
      const record: ResponseStatusRecord = {
        endReason,
        nextAction: outcome.nextAction,
        durationMs: Date.now() - this.responseStartTime,
        stepsCompleted: this.stepsCompleted,
        error: this.responseStepProcessor.thrownError,
        blockedReason: outcome.blockedReason,
      };
      this.appendResponseStatus(record);
      this.logger.debug(
        `[state:${this.getChannelKey()}] end reason=${endReason} nextAction=${outcome.nextAction} steps=${this.stepsCompleted} durationMs=${record.durationMs}`,
      );

      this.setResponseState("idle", "response_status_persisted");
      this.abortController = null;

      if (outcome.nextAction === "follow_up") {
        const pendingFollowUp = this.consumePendingFollowUp();
        if (pendingFollowUp) {
          const followUpReview = this.createFollowUpReviewRecord(pendingFollowUp);
          this.session.appendStateChange({
            id: createRuntimeRecordId(),
            timestamp: Date.now(),
            stage: "runtime",
            visibility: "internal",
            materialization: "internal",
            stateType: "follow_up_review",
            data: { ...followUpReview },
          });
          this.nextTurnFollowUpReview = followUpReview;
        }
        this.currentTurnSettings = null;
        this.currentTurnInstructions = null;
        this.currentTurnFollowUpReview = null;
        this.currentResponseContext = undefined;
        this.currentToolExperimentalContext = undefined;
        this.currentProtocolRetry = false;
        this.runResponse().catch(() => {});
        return;
      }

      this.pendingFollowUp = null;
      this.currentTurnSettings = null;
      this.currentTurnInstructions = null;
      this.currentTurnFollowUpReview = null;
      this.currentResponseContext = undefined;
      this.currentToolExperimentalContext = undefined;
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
    experimental_context?: unknown;
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
        experimental_context: this.currentToolExperimentalContext,
        messages: [system, ...trimmed],
      };
    }

    return {
      activeTools: this.responseActiveTools,
      experimental_context: this.currentToolExperimentalContext,
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
      getReliableInputTokens(totalUsage) ?? estimateContextTokens(this.session.getModelMessages());

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
    const records = [...this.session.getTimeline()];
    if (records.length === 0) {
      return { compacted: false, reason: "empty-session" };
    }

    const latestCompaction = this.getLatestCompactionSidecar();
    if (latestCompaction !== undefined && this.isLatestSessionEntryCompaction()) {
      return { compacted: false, reason: "already-compacted" };
    }

    const compactionRecords = this.getCompactionRecords(
      records,
      latestCompaction?.firstKeptEntryId,
    );
    const preparation = prepareCompaction(
      compactionRecords,
      turnSettings.compactionSettings,
      latestCompaction?.summary,
      contextTokens,
    );
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

  private getLatestCompactionSidecar():
    | {
        summary: string;
        firstKeptEntryId: string;
      }
    | undefined {
    const entries = this.sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry?.type === "compaction") {
        return {
          summary: entry.summary,
          firstKeptEntryId: entry.firstKeptEntryId,
        };
      }
    }

    return undefined;
  }

  private isLatestSessionEntryCompaction(): boolean {
    const entries = this.sessionManager.getEntries();
    return entries[entries.length - 1]?.type === "compaction";
  }

  private getCompactionRecords(
    records: readonly TimelineRecord[],
    firstKeptEntryId?: string,
  ): readonly TimelineRecord[] {
    if (!firstKeptEntryId) {
      return records;
    }

    const firstKeptIndex = records.findIndex((record) => record.id === firstKeptEntryId);
    if (firstKeptIndex === -1) {
      return records;
    }

    return records.slice(firstKeptIndex);
  }
}

const ABORT_REJECTION_GRACE_MS = 100;

async function abortable<T>(signal: AbortSignal, operation: () => PromiseLike<T>): Promise<T> {
  if (signal.aborted) {
    throw new Error("aborted");
  }

  return new Promise<T>((resolve, reject) => {
    let abortTimer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      abortTimer = setTimeout(() => {
        reject(new Error("aborted"));
      }, ABORT_REJECTION_GRACE_MS);
    };

    signal.addEventListener("abort", onAbort, { once: true });

    operation().then(
      (value) => {
        if (abortTimer) {
          clearTimeout(abortTimer);
        }
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        if (abortTimer) {
          clearTimeout(abortTimer);
        }
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function isAbortLikeThrownError(message: string): boolean {
  return /\babort(?:ed|ing)?\b/i.test(message);
}

function isTimeoutLikeThrownError(message: string): boolean {
  return /\btime(?:d)?\s*out\b/i.test(message);
}

function createRuntimeRecordId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function getResponseStatusNoticeSubType(
  endReason: ResponseStatusReason,
): ResponseStatusNoticeSubType {
  switch (endReason) {
    case "normal":
      return "response_status_normal";
    case "heartbeat_continuation":
      return "response_status_heartbeat_continuation";
    case "protocol_error":
      return "response_status_protocol_error";
    case "timeout":
      return "response_status_timeout";
    case "abort":
      return "response_status_abort";
    case "exception":
      return "response_status_exception";
  }
}

function buildResponseStatusNotice(
  subType: ResponseStatusNoticeSubType,
  record: ResponseStatusRecord,
): string {
  return [
    `[response-status] ${subType}`,
    `endReason=${record.endReason}`,
    `nextAction=${record.nextAction}`,
    `stepsCompleted=${record.stepsCompleted}`,
    `durationMs=${record.durationMs}`,
  ].join(" ");
}
