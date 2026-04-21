import { dirname } from "node:path";

import type { ModelMessage } from "@ai-sdk/provider-utils";
import type { IPluginService, ToolCatalog, ToolSelection } from "@yesimbot/plugin-sdk";
import type {
  LanguageModel,
  OnFinishEvent,
  OnStepFinishEvent,
  PrepareStepResult,
  ToolSet,
} from "ai";
import { stepCountIs, ToolLoopAgent } from "ai";
import { Bot, Context, Logger } from "koishi";

import { AgentSession } from "../agent-session";
import { compact, prepareCompaction, shouldCompact } from "../compaction";
import { estimateContextTokens } from "../compaction/estimate";
import { InstructionAssembler } from "../instruction-state/assembler";
import { InstructionStateService } from "../instruction-state/service";
import { convertToLlm } from "../materialize";
import type {
  ActivationResult,
  AthenaEvent,
  EventBatch,
  FollowUpReviewRecord,
  ResponseStatusReason,
  ResponseStatusRecord,
} from "../messages";
import { createDefaultWillingnessJudge, WillingnessJudge } from "../messages/activation";
import {
  createEmptyStepTranscriptWriteSummary,
  getReliableInputTokens,
  hasCompletedSendMessageWithoutHeartbeat,
  mergeStepTranscriptWriteSummary,
  PROTOCOL_GUIDANCE_TEXT,
  StepTranscriptWriter,
  type StepTranscriptWriteSummary,
} from "../messages/step-transcript-writer";
import type { SessionManager } from "../session-manager";
import { prepareRuntimeModel } from "./model-adapter";
import { createSendMessageTool } from "./send-message-tool";
import type {
  SessionRuntimeOptions,
  SessionRuntimeSnapshot,
  ResponseWindowSettingsSnapshot,
  CompactionRunResult,
  MergedFollowUpOpportunity,
  NextActionSelection,
  ResponseState,
  SessionRuntimeExecutionOptions,
  SessionRuntimeExecutionResult,
} from "./types";

// ============================================================================
// SessionRuntime
// ============================================================================

type ResponseHostInput = {
  triggerEvents: EventBatch["events"];
  responderId: string;
  channelId: string;
  platform: string;
  startedAt: number;
};

export interface ActivatedEventBatch extends EventBatch {
  activation: ActivationResult;
}

/**
 * Per-channel runtime wrapping AI SDK ToolLoopAgent + SessionManager.
 *
 * Responsibilities:
 * - Consume activation-approved batches and run runtime execution
 * - Schedule and execute AI responses via ToolLoopAgent
 * - Persist AI response steps to SessionManager
 * - Manage concurrency (prevent parallel generate() calls per channel)
 */
export class SessionRuntime {
  bot: Bot | undefined;
  readonly sessionManager: SessionManager;
  readonly session: AgentSession;

  private options: SessionRuntimeOptions;
  private responseState: ResponseState = "idle";
  private abortController: AbortController | null = null;
  private readonly runtimeSnapshot: SessionRuntimeSnapshot = {
    state: "idle",
    busyWindow: {
      responseWindow: null,
      instructions: null,
      activeFollowUpReview: null,
      queuedFollowUpReview: null,
      protocolRetry: false,
      startedAt: 0,
      completedSteps: 0,
      activeTools: [],
    },
    pendingFollowUp: null,
    responseContext: undefined,
    toolExperimentalContext: undefined,
  };
  private cachedAgent: ToolLoopAgent<never, ToolSet> | null = null;
  private cachedAgentSignature: string | null = null;
  private cachedPreparedModel: ReturnType<typeof prepareRuntimeModel> | null = null;
  private cachedPreparedModelSignature: string | null = null;
  public currentSupportedToolSignature: string | null = null;
  private currentToolCatalog: ToolCatalog | null = null;
  private currentToolSelection: ToolSelection | null = null;
  private pendingActivatedBatches: ActivatedEventBatch[] = [];
  private readonly stepTranscriptWriter: StepTranscriptWriter;
  private currentStepSummary: StepTranscriptWriteSummary = createEmptyStepTranscriptWriteSummary();
  private readonly willingnessJudge: WillingnessJudge;
  private readonly logger: Logger;
  private readonly instructionAssembler: InstructionAssembler;

  get snapshot(): SessionRuntimeSnapshot {
    return {
      state: this.runtimeSnapshot.state,
      pendingFollowUp: this.runtimeSnapshot.pendingFollowUp
        ? {
            ...this.runtimeSnapshot.pendingFollowUp,
            messageIds: [...this.runtimeSnapshot.pendingFollowUp.messageIds],
          }
        : null,
      responseContext: this.runtimeSnapshot.responseContext,
      toolExperimentalContext: this.runtimeSnapshot.toolExperimentalContext,
      busyWindow: {
        responseWindow: this.runtimeSnapshot.busyWindow.responseWindow
          ? {
              ...this.runtimeSnapshot.busyWindow.responseWindow,
              compactionSettings: {
                ...this.runtimeSnapshot.busyWindow.responseWindow.compactionSettings,
              },
            }
          : null,
        instructions: this.runtimeSnapshot.busyWindow.instructions,
        activeFollowUpReview: this.runtimeSnapshot.busyWindow.activeFollowUpReview
          ? {
              ...this.runtimeSnapshot.busyWindow.activeFollowUpReview,
              messageIds: [...this.runtimeSnapshot.busyWindow.activeFollowUpReview.messageIds],
            }
          : null,
        queuedFollowUpReview: this.runtimeSnapshot.busyWindow.queuedFollowUpReview
          ? {
              ...this.runtimeSnapshot.busyWindow.queuedFollowUpReview,
              messageIds: [...this.runtimeSnapshot.busyWindow.queuedFollowUpReview.messageIds],
            }
          : null,
        protocolRetry: this.runtimeSnapshot.busyWindow.protocolRetry,
        startedAt: this.runtimeSnapshot.busyWindow.startedAt,
        completedSteps: this.runtimeSnapshot.busyWindow.completedSteps,
        activeTools: [...this.runtimeSnapshot.busyWindow.activeTools],
      },
    };
  }

  constructor(
    private ctx: Context,
    options: SessionRuntimeOptions,
  ) {
    this.options = options;
    this.bot = options.bot;
    this.sessionManager = options.sessionManager;
    this.session = new AgentSession(this.sessionManager);
    this.logger = this.ctx.logger("session");
    this.logger.level = 3;
    this.willingnessJudge = options.willingnessJudge ?? createDefaultWillingnessJudge(this.ctx);
    this.stepTranscriptWriter = new StepTranscriptWriter({
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
      contributors: options.instructions,
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
    this.runtimeSnapshot.state = nextState;
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

  private createResponseWindowSnapshot(): ResponseWindowSettingsSnapshot {
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

  private getActiveResponseWindow(): ResponseWindowSettingsSnapshot {
    return this.runtimeSnapshot.busyWindow.responseWindow ?? this.createResponseWindowSnapshot();
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
    responseWindow: ResponseWindowSettingsSnapshot,
    model: LanguageModel,
  ): ToolLoopAgent<never, ToolSet> {
    const cumulativeTimeoutMs =
      responseWindow.baseTimeoutMs + responseWindow.maxSteps * responseWindow.perStepTimeoutMs;
    return new ToolLoopAgent<never, ToolSet>({
      model,
      tools: {},
      stopWhen: [
        stepCountIs(responseWindow.maxSteps),
        ({ steps }) =>
          hasCompletedSendMessageWithoutHeartbeat(steps) ||
          this.currentStepSummary.completedSendMessageWithoutHeartbeat,
      ],
      timeout: {
        totalMs: cumulativeTimeoutMs,
        chunkMs: responseWindow.chunkTimeoutMs,
      },
      prepareCall: async (options) => ({
        ...options,
        experimental_context: this.runtimeSnapshot.toolExperimentalContext,
      }),
      prepareStep: this.handlePrepareStep.bind(this),
      onStepFinish: this.handleStepFinish.bind(this),
      onFinish: this.handleFinish.bind(this),
    });
  }

  private getAgentSignature(
    responseWindow: ResponseWindowSettingsSnapshot,
    modelMode: string,
  ): string {
    return [
      responseWindow.modelId,
      modelMode,
      responseWindow.maxSteps,
      responseWindow.baseTimeoutMs,
      responseWindow.perStepTimeoutMs,
      responseWindow.chunkTimeoutMs,
    ].join(":");
  }

  private getOrCreateAgent(
    responseWindow: ResponseWindowSettingsSnapshot,
    model: LanguageModel,
    modelMode: string,
  ): ToolLoopAgent<never, ToolSet> {
    const nextSignature = this.getAgentSignature(responseWindow, modelMode);
    if (this.cachedAgent && this.cachedAgentSignature === nextSignature) {
      return this.cachedAgent;
    }

    const agent = this.createAgent(responseWindow, model);
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
    responseWindow: ResponseWindowSettingsSnapshot,
    requiresTools: boolean,
  ): ReturnType<typeof prepareRuntimeModel> {
    const nextSignature = this.getAgentSignature(
      responseWindow,
      requiresTools ? "tools-requested" : "plain",
    );
    if (this.cachedPreparedModel && this.cachedPreparedModelSignature === nextSignature) {
      return this.cachedPreparedModel;
    }

    const preparedModel = prepareRuntimeModel({
      registry: this.ctx["yesimbot.model"],
      modelId: responseWindow.modelId,
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

  async receive(_input?: unknown): Promise<never> {
    throw new Error(
      "Raw ingress is no longer accepted here. Use AgentSessionService.ingestEvent(...) instead.",
    );
  }

  async wake(batch: ActivatedEventBatch): Promise<void> {
    this.pendingActivatedBatches.push(batch);

    if (this.hasActiveTurn()) {
      const latestMessage = findLatestMessageEvent(batch.events);
      this.markPendingFollowUp({
        observedAt: latestMessage?.timestamp ?? Date.now(),
        messageId: latestMessage?.messageId ?? batch.batchId,
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

  getSettingsManager(): SessionRuntimeOptions["settingsManager"] {
    return this.options.settingsManager;
  }

  getWillingnessJudge(): WillingnessJudge {
    return this.willingnessJudge;
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
    this.session.appendResponseStatus(record);
  }

  private markPendingFollowUp(input: { observedAt: number; messageId: string }): void {
    if (!this.runtimeSnapshot.pendingFollowUp) {
      this.runtimeSnapshot.pendingFollowUp = {
        pending: true,
        firstObservedAt: input.observedAt,
        latestObservedAt: input.observedAt,
        messageCount: 1,
        messageIds: [input.messageId],
      };
      this.logger.debug(`[state:${this.getChannelKey()}] pending_follow_up observed`);
      return;
    }

    this.runtimeSnapshot.pendingFollowUp.latestObservedAt = input.observedAt;
    this.runtimeSnapshot.pendingFollowUp.pending = true;
    if (!this.runtimeSnapshot.pendingFollowUp.messageIds.includes(input.messageId)) {
      this.runtimeSnapshot.pendingFollowUp.messageIds.push(input.messageId);
      this.runtimeSnapshot.pendingFollowUp.messageCount =
        this.runtimeSnapshot.pendingFollowUp.messageIds.length;
    }
    this.logger.debug(`[state:${this.getChannelKey()}] pending_follow_up updated`);
  }

  private consumePendingFollowUp(): MergedFollowUpOpportunity | null {
    const pendingFollowUp = this.runtimeSnapshot.pendingFollowUp;
    this.runtimeSnapshot.pendingFollowUp = null;
    return pendingFollowUp;
  }

  private buildRuntimeMessages(instructions: string, protocolRetry: boolean): ModelMessage[] {
    const latestCompaction = this.getLatestCompactionSidecar();
    const sessionMessages = latestCompaction
      ? this.getSessionMessagesFromCompactionBoundary(latestCompaction.firstKeptEntryId)
      : this.session.getSessionMessages();
    const modelMessages = convertToLlm([...sessionMessages]);
    const runtimeMessages: ModelMessage[] = latestCompaction
      ? [
          {
            role: "user",
            content: `[Context Summary]\n${latestCompaction.summary}`,
          },
          ...modelMessages,
        ]
      : modelMessages;

    if (this.runtimeSnapshot.busyWindow.activeFollowUpReview?.content) {
      runtimeMessages.push({
        role: "user",
        content: this.runtimeSnapshot.busyWindow.activeFollowUpReview.content,
      });
    }

    if (protocolRetry) {
      runtimeMessages.push({
        role: "user",
        content: PROTOCOL_GUIDANCE_TEXT,
      });
    }

    return [{ role: "system", content: instructions }, ...runtimeMessages];
  }

  // @ts-expect-error ChannelMessageInput was removed
  private getLatestChannelMessageInput(): ChannelMessageInput<ChannelRawPayload | undefined> {
    const sessionMessages = this.session.getSessionMessages();
    for (let i = sessionMessages.length - 1; i >= 0; i--) {
      const message = sessionMessages[i];
      if ("type" in message && message.type === "user.message") {
        return {
          kind: "channel_message",
          platform: this.options.platform,
          channelId: this.options.channelId,
          messageId: message.data.messageId,
          timestamp: Date.parse(message.timestamp),
          content: message.data.content,
          sender: {
            userId: message.data.senderId,
            username: message.data.senderName ?? message.data.senderId,
            nickname: message.data.senderName,
          },
          isDirect: false,
          atSelf: false,
          isReplyToBot: false,
          replyTo: message.data.replyTo
            ? {
                messageId: message.data.replyTo.messageId ?? "unknown-message",
                username: message.data.replyTo.senderName ?? "unknown-user",
                nickname: message.data.replyTo.senderName ?? "unknown-user",
                summary: message.data.replyTo.content ?? "",
              }
            : undefined,
        };
      }
    }

    return undefined;
  }

  private createToolRuntime(
    responseWindow: ResponseWindowSettingsSnapshot,
    // @ts-expect-error ChannelMessageInput was removed
    latestInput: ChannelMessageInput<ChannelRawPayload>,
  ) {
    return {
      channelKey: this.getChannelKey(),
      platform: this.options.platform,
      channelId: this.options.channelId,
      modelId: responseWindow.modelId,
      basePath: this.options.basePath,
      // Plugin runtime compatibility still expects an outer turn-shaped envelope.
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
    const triggerEvents = this.pendingActivatedBatches.flatMap((batch) => batch.events);
    return {
      triggerEvents: [...triggerEvents],
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
    options: SessionRuntimeExecutionOptions,
  ): Promise<SessionRuntimeExecutionResult> {
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
    this.runtimeSnapshot.busyWindow.instructions = instructions;
    this.runtimeSnapshot.busyWindow.protocolRetry = options.protocolRetry;
    const modelMessages = this.buildRuntimeMessages(instructions, options.protocolRetry);

    const sendMessageTool = createSendMessageTool({
      bot: options.bot,
      channelId: options.channelId,
    });
    const builtinTools = { send_message: sendMessageTool } satisfies ToolSet;
    const pluginService = options.ctx["yesimbot.plugin"] as IPluginService | undefined;
    const runtime = this.createToolRuntime(options.responseWindow, latestInput);
    const responseHostInput = this.buildResponseHostInput();
    this.pendingActivatedBatches = [];
    const toolLifecycle = pluginService?.compileTools
      ? await (async () => {
          if (!this.currentToolCatalog) {
            this.currentToolCatalog = await pluginService.compileTools({
              runtime,
              scope: this.getToolScope(),
            });
          }

          const catalog = this.currentToolCatalog;
          const responseContext = await pluginService.buildContext({
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
            builtinTools,
          });
          this.currentToolSelection = toolSelection;
          const supportedTools = {
            ...builtinTools,
            ...catalog.tools,
          } satisfies ToolSet;

          return {
            supportedTools,
            activeTools: toolSelection.activeTools,
            responseContext: toolSelection.responseContext,
            signature: JSON.stringify(Object.keys(supportedTools).sort()),
          };
        })()
      : (() => {
          this.currentToolSelection = null;
          options.logger.warn(
            `[tools:${channelKey}] PluginService unavailable; continuing with send_message only`,
          );

          return {
            supportedTools: builtinTools,
            activeTools: builtinTools,
            responseContext: {},
            signature: JSON.stringify(Object.keys(builtinTools).sort()),
          };
        })();
    const responseActiveTools =
      this.currentToolSelection?.activeToolNames ?? Object.keys(toolLifecycle.activeTools);
    this.runtimeSnapshot.busyWindow.activeTools = responseActiveTools;
    this.runtimeSnapshot.responseContext = toolLifecycle.responseContext;
    this.runtimeSnapshot.toolExperimentalContext = this.runtimeSnapshot.responseContext;

    const preparedModel = this.getPreparedModel(
      options.responseWindow,
      responseActiveTools.length > 0,
    );
    const modelMode =
      responseActiveTools.length > 0 && preparedModel.entry.toolCall === false
        ? "tool-compat"
        : "raw";

    const agent = this.getOrCreateAgent(options.responseWindow, preparedModel.model, modelMode);
    if (this.currentSupportedToolSignature !== toolLifecycle.signature) {
      this.syncAgentTools(agent, toolLifecycle.supportedTools);
      this.currentSupportedToolSignature = toolLifecycle.signature;
    }

    options.logger.debug(
      `[llm:${channelKey}] start streaming=${options.responseWindow.streaming} messages=${modelMessages.length} tools=${responseActiveTools.length} retry=${options.protocolRetry}`,
    );

    if (options.responseWindow.streaming) {
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
      this.runtimeSnapshot.busyWindow.activeFollowUpReview =
        this.runtimeSnapshot.busyWindow.queuedFollowUpReview;
      this.runtimeSnapshot.busyWindow.queuedFollowUpReview = null;
    }

    this.stepTranscriptWriter.beginResponse(protocolRetry);
    this.currentStepSummary = createEmptyStepTranscriptWriteSummary();
    this.setResponseState("responding", protocolRetry ? "protocol_retry" : "response_start");
    this.abortController = new AbortController();
    this.runtimeSnapshot.busyWindow.startedAt = Date.now();
    this.runtimeSnapshot.busyWindow.completedSteps = 0;
    this.runtimeSnapshot.busyWindow.responseWindow = this.createResponseWindowSnapshot();

    const responseWindow = this.runtimeSnapshot.busyWindow.responseWindow;
    const timeoutMs =
      responseWindow.baseTimeoutMs + responseWindow.maxSteps * responseWindow.perStepTimeoutMs;
    let timedOut = false;
    let scheduleProtocolRetry = false;
    let scheduleFollowUp = false;

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
        responseWindow,
        protocolRetry,
        abortSignal: this.abortController.signal,
      });
      this.runtimeSnapshot.busyWindow.activeTools = executionResult.responseActiveTools;
    } catch (err: unknown) {
      const thrownError = err instanceof Error ? err.message : String(err);
      this.currentStepSummary = mergeStepTranscriptWriteSummary(this.currentStepSummary, {
        ...createEmptyStepTranscriptWriteSummary(),
        sendFailure: true,
        thrownError,
      });

      this.ctx.logger.error(
        `Response failed for ${this.options.platform}:${this.options.channelId}: ${this.currentStepSummary.thrownError}`,
      );
    } finally {
      clearTimeout(watchdog);

      if (this.currentStepSummary.pendingProtocolRetry) {
        this.setResponseState("idle", "protocol_retry_pending");
        this.abortController = null;
        this.runtimeSnapshot.busyWindow.responseWindow = null;
        this.runtimeSnapshot.busyWindow.instructions = null;
        this.runtimeSnapshot.responseContext = undefined;
        this.runtimeSnapshot.toolExperimentalContext = undefined;
        this.runtimeSnapshot.busyWindow.protocolRetry = false;
        scheduleProtocolRetry = true;
      } else {
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
          protocolError: this.currentStepSummary.protocolError,
          heartbeatRequested: this.currentStepSummary.heartbeatRequested,
          sendFailure: this.currentStepSummary.sendFailure,
          thrownError: this.currentStepSummary.thrownError,
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
          hasPendingFollowUp: Boolean(this.runtimeSnapshot.pendingFollowUp?.pending),
          thrownError: this.currentStepSummary.thrownError,
        });
        const record: ResponseStatusRecord = {
          endReason,
          nextAction: outcome.nextAction,
          durationMs: Date.now() - this.runtimeSnapshot.busyWindow.startedAt,
          stepsCompleted: this.runtimeSnapshot.busyWindow.completedSteps,
          error: this.currentStepSummary.thrownError,
          blockedReason: outcome.blockedReason,
        };
        this.appendResponseStatus(record);
        this.logger.debug(
          `[state:${this.getChannelKey()}] end reason=${endReason} nextAction=${outcome.nextAction} steps=${this.runtimeSnapshot.busyWindow.completedSteps} durationMs=${record.durationMs}`,
        );

        this.setResponseState("idle", "response_status_persisted");
        this.abortController = null;

        if (outcome.nextAction === "follow_up") {
          const pendingFollowUp = this.consumePendingFollowUp();
          if (pendingFollowUp) {
            const followUpReview = this.createFollowUpReviewRecord(pendingFollowUp);
            this.session.appendRuntimeStateInfo("follow_up_review", undefined, followUpReview);
            this.runtimeSnapshot.busyWindow.queuedFollowUpReview = followUpReview;
          }
          this.runtimeSnapshot.busyWindow.responseWindow = null;
          this.runtimeSnapshot.busyWindow.instructions = null;
          this.runtimeSnapshot.busyWindow.activeFollowUpReview = null;
          this.runtimeSnapshot.responseContext = undefined;
          this.runtimeSnapshot.toolExperimentalContext = undefined;
          this.runtimeSnapshot.busyWindow.protocolRetry = false;
          scheduleFollowUp = true;
        } else {
          this.runtimeSnapshot.pendingFollowUp = null;
          this.runtimeSnapshot.busyWindow.responseWindow = null;
          this.runtimeSnapshot.busyWindow.instructions = null;
          this.runtimeSnapshot.busyWindow.activeFollowUpReview = null;
          this.runtimeSnapshot.responseContext = undefined;
          this.runtimeSnapshot.toolExperimentalContext = undefined;
          this.runtimeSnapshot.busyWindow.protocolRetry = false;
        }
      }
    }

    if (scheduleProtocolRetry) {
      this.runResponse(true).catch(() => {});
      return;
    }

    if (scheduleFollowUp) {
      this.runResponse().catch(() => {});
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
    const nextMessages = this.runtimeSnapshot.busyWindow.instructions
      ? this.buildRuntimeMessages(
          this.runtimeSnapshot.busyWindow.instructions,
          this.runtimeSnapshot.busyWindow.protocolRetry,
        )
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
        activeTools: this.runtimeSnapshot.busyWindow.activeTools,
        experimental_context: this.runtimeSnapshot.toolExperimentalContext,
        messages: [system, ...trimmed],
      };
    }

    return {
      activeTools: this.runtimeSnapshot.busyWindow.activeTools,
      experimental_context: this.runtimeSnapshot.toolExperimentalContext,
      messages: nextMessages,
    };
  }

  /**
   * Called after each LLM step. Persists messages and enforces tool-first outbound protocol.
   */
  private handleStepFinish(stepResult: OnStepFinishEvent): void {
    this.runtimeSnapshot.busyWindow.completedSteps++;
    this.currentStepSummary = mergeStepTranscriptWriteSummary(
      this.currentStepSummary,
      this.stepTranscriptWriter.writeStep(stepResult),
    );
    this.logger.debug(
      `[step:${this.getChannelKey()}] completed count=${this.runtimeSnapshot.busyWindow.completedSteps} finishReason=${stepResult.finishReason ?? "unknown"}`,
    );
  }

  private handleFinish(event: OnFinishEvent): void {
    const responseWindow = this.getActiveResponseWindow();
    const totalUsage = event.totalUsage ?? event.usage;
    const contextTokens =
      getReliableInputTokens(totalUsage) ?? estimateContextTokens(this.session.getModelMessages());

    if (
      !shouldCompact(contextTokens, responseWindow.contextWindow, responseWindow.compactionSettings)
    ) {
      return;
    }

    this.runCompaction(contextTokens, responseWindow).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.ctx.logger.error(
        `Compaction failed for ${this.options.platform}:${this.options.channelId}: ${msg}`,
      );
    });
  }

  public async runCompaction(
    contextTokens: number,
    responseWindow = this.createResponseWindowSnapshot(),
  ): Promise<CompactionRunResult> {
    const entries = this.session
      .getEntries()
      .filter(
        (
          entry,
        ): entry is Extract<ReturnType<AgentSession["getEntries"]>[number], { type: "message" }> =>
          entry.type === "message",
      );
    if (entries.length === 0) {
      return { compacted: false, reason: "empty-session" };
    }

    const latestCompaction = this.getLatestCompactionSidecar();
    if (latestCompaction !== undefined && this.isLatestSessionEntryCompaction()) {
      return { compacted: false, reason: "already-compacted" };
    }

    const compactionEntries = this.getCompactionEntries(
      entries,
      latestCompaction?.firstKeptEntryId,
    );
    const preparation = prepareCompaction(
      compactionEntries,
      responseWindow.compactionSettings,
      latestCompaction?.summary,
      contextTokens,
    );
    if (!preparation) {
      return { compacted: false, reason: "nothing-to-compact" };
    }

    const compactionModelId = responseWindow.compactionSettings.model ?? responseWindow.modelId;
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

  private getCompactionEntries(
    entries: Array<Extract<ReturnType<AgentSession["getEntries"]>[number], { type: "message" }>>,
    firstKeptEntryId?: string,
  ): Array<Extract<ReturnType<AgentSession["getEntries"]>[number], { type: "message" }>> {
    if (!firstKeptEntryId) {
      return entries;
    }

    const firstKeptIndex = entries.findIndex((entry) => entry.id === firstKeptEntryId);
    if (firstKeptIndex === -1) {
      return entries;
    }

    return entries.slice(firstKeptIndex);
  }

  private getSessionMessagesFromCompactionBoundary(
    firstKeptEntryId: string,
  ): ReturnType<AgentSession["getSessionMessages"]> {
    const entries = this.session.getEntries();
    const firstKeptIndex = entries.findIndex((entry) => entry.id === firstKeptEntryId);
    if (firstKeptIndex === -1) {
      return this.session.getSessionMessages();
    }

    return entries
      .slice(firstKeptIndex)
      .filter(
        (entry): entry is Extract<(typeof entries)[number], { type: "message" }> =>
          entry.type === "message",
      )
      .map((entry) => entry.message);
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

function findLatestMessageEvent(
  events: AthenaEvent[],
): Extract<AthenaEvent, { kind: "message" }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind === "message") {
      return event;
    }
  }

  return null;
}
