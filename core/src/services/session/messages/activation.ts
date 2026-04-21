import { generateText } from "ai";
import { Context } from "koishi";

import type {
  AthenaChannelEvent,
  AthenaEvent,
  AthenaInternalSignalEvent,
  AthenaMessageEvent,
  AthenaPlatformNoticeEvent,
} from "./athena-event";
import type { ChannelKey } from "./runtime-types";

export interface WillingnessResult {
  shouldRespond: boolean;
  reason:
    | "direct_message"
    | "at_self"
    | "llm_judge"
    | "reply_without_at"
    | "no_trigger"
    | "self_message";
}

export interface JudgeResult {
  decision: boolean;
  confidence?: number;
  reasoning?: string;
  factors?: Record<string, number>;
}

interface JudgeCallParams {
  content: string;
  judgeModel?: string;
  timeoutMs?: number;
}

function parseJudgeResult(raw: string): JudgeResult | null {
  try {
    const parsed = JSON.parse(raw) as Partial<JudgeResult>;
    if (typeof parsed.decision !== "boolean") {
      return null;
    }

    return {
      decision: parsed.decision,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
      factors:
        parsed.factors && typeof parsed.factors === "object" && !Array.isArray(parsed.factors)
          ? (parsed.factors as Record<string, number>)
          : undefined,
    };
  } catch {
    return null;
  }
}

function readGlobalJudgeModel(ctx: Context): string | undefined {
  const unknownConfig = (ctx as unknown as { config?: Record<string, unknown> }).config;
  const judgeModel = unknownConfig?.judgeModel;
  const model = unknownConfig?.model;
  if (typeof judgeModel === "string" && judgeModel.length > 0) {
    return judgeModel;
  }
  if (typeof model === "string" && model.length > 0) {
    return model;
  }
  return undefined;
}

export function buildJudgePrompt(content: string): string {
  return `You are a conversation participation judge for a chat bot.

## Task
Decide whether the bot should reply to the message below.

## Message
${content}

## Output Format
Respond with ONLY a JSON object:
{
  "decision": true,
  "confidence": 0.85,
  "reasoning": "brief explanation"
}

decision: true = reply, false = stay silent
confidence: optional number in range 0.0-1.0
reasoning: optional short explanation`;
}

export async function callLLMJudge(
  ctx: Context,
  params: JudgeCallParams,
): Promise<JudgeResult | null> {
  const modelId = params.judgeModel ?? readGlobalJudgeModel(ctx);
  if (!modelId) {
    return null;
  }

  try {
    const logger = ctx.logger("session");
    logger.debug(`[judge] start model=${modelId}`);
    const model = ctx["yesimbot.model"].resolve(modelId);
    const result = await generateText({
      model,
      system: "You must answer with valid JSON only.",
      prompt: buildJudgePrompt(params.content),
      maxOutputTokens: 256,
      abortSignal: AbortSignal.timeout(params.timeoutMs ?? 10000),
    });

    const parsed = parseJudgeResult(result.text.trim());
    logger.debug(`[judge] end model=${modelId} decision=${parsed?.decision ?? "invalid"}`);
    return parsed;
  } catch (error: unknown) {
    const logger = ctx.logger("session");
    logger.debug(
      `[judge] failed model=${modelId} error=${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export interface WillingnessJudgeParams {
  isDirect: boolean;
  atSelf: boolean;
  isReplyToBot: boolean;
  content: string;
  selfId: string;
  senderId: string;
  judgeEnabled?: boolean;
  judgeModel?: string;
  judgeTimeoutMs?: number;
}

export interface RuntimeWillingnessHeuristicParams {
  isDirect: boolean;
  atSelf: boolean;
  isReplyToBot: boolean;
  selfId: string;
  senderId: string;
}

export interface ActivationPolicyInput extends RuntimeWillingnessHeuristicParams {
  content: string;
  judgeEnabled?: boolean;
  judgeModel?: string;
  judgeTimeoutMs?: number;
}

export function evaluateRuntimeWillingnessHeuristic(
  params: RuntimeWillingnessHeuristicParams,
): WillingnessResult | null {
  if (params.senderId === params.selfId) {
    return { shouldRespond: false, reason: "self_message" };
  }

  if (params.isDirect) {
    return { shouldRespond: true, reason: "direct_message" };
  }

  if (params.atSelf) {
    return { shouldRespond: true, reason: "at_self" };
  }

  if (params.isReplyToBot && !params.atSelf) {
    return { shouldRespond: false, reason: "reply_without_at" };
  }

  return null;
}

function readJudgeEnabled(ctx: Context): boolean {
  const unknownConfig = (ctx as unknown as { config?: Record<string, unknown> }).config;
  return unknownConfig?.judgeEnabled === true;
}

export interface WillingnessJudge {
  judge(params: WillingnessJudgeParams): Promise<WillingnessResult>;
}

interface DefaultWillingnessJudgeOptions {
  ctx: Context;
  llmJudge?: (params: {
    content: string;
    judgeModel?: string;
    timeoutMs?: number;
  }) => Promise<JudgeResult | null>;
}

export class DefaultWillingnessJudge implements WillingnessJudge {
  private readonly ctx: Context;
  private readonly llmJudge: NonNullable<DefaultWillingnessJudgeOptions["llmJudge"]>;

  constructor(options: DefaultWillingnessJudgeOptions) {
    this.ctx = options.ctx;
    this.llmJudge =
      options.llmJudge ??
      ((params) =>
        callLLMJudge(this.ctx, {
          content: params.content,
          judgeModel: params.judgeModel,
          timeoutMs: params.timeoutMs,
        }));
  }

  async judge(params: WillingnessJudgeParams): Promise<WillingnessResult> {
    const judgeEnabled = params.judgeEnabled ?? readJudgeEnabled(this.ctx);
    if (!judgeEnabled) {
      return { shouldRespond: false, reason: "no_trigger" };
    }

    const judge = await this.llmJudge({
      content: params.content,
      judgeModel: params.judgeModel,
      timeoutMs: params.judgeTimeoutMs,
    });
    if (judge?.decision) {
      return { shouldRespond: true, reason: "llm_judge" };
    }

    return { shouldRespond: false, reason: "no_trigger" };
  }
}

export function createDefaultWillingnessJudge(ctx: Context): WillingnessJudge {
  return new DefaultWillingnessJudge({ ctx });
}

export async function evaluateActivationPolicy(
  judge: WillingnessJudge,
  params: ActivationPolicyInput,
): Promise<WillingnessResult> {
  const heuristic = evaluateRuntimeWillingnessHeuristic(params);
  if (heuristic) {
    return heuristic;
  }

  return judge.judge({
    isDirect: params.isDirect,
    atSelf: params.atSelf,
    isReplyToBot: params.isReplyToBot,
    content: params.content,
    selfId: params.selfId,
    senderId: params.senderId,
    judgeEnabled: params.judgeEnabled,
    judgeModel: params.judgeModel,
    judgeTimeoutMs: params.judgeTimeoutMs,
  });
}

export async function judgeWillingness(
  ctx: Context,
  params: WillingnessJudgeParams,
): Promise<WillingnessResult> {
  return evaluateActivationPolicy(createDefaultWillingnessJudge(ctx), params);
}

export interface EventBatch {
  batchId: string;
  channelKey: ChannelKey;
  events: AthenaEvent[];
}

export type ActivationReasonCode =
  | WillingnessResult["reason"]
  | "channel_event"
  | "platform_notice"
  | "internal_signal";

export interface ActivationReason {
  source: "policy" | "event";
  code: ActivationReasonCode;
  detail?: string;
}

export interface ActivationResult {
  batchId: string;
  activated: boolean;
  reasons: ActivationReason[];
}

function isMessageEvent(event: AthenaEvent): event is AthenaMessageEvent {
  return event.kind === "message";
}

function toHeuristicParams(event: AthenaMessageEvent): RuntimeWillingnessHeuristicParams {
  return {
    isDirect: event.isDirect,
    atSelf: event.atSelf,
    isReplyToBot: event.isReplyToBot,
    selfId: "",
    senderId: event.sender.userId,
  };
}

function toPolicyReason(reason: WillingnessResult["reason"]): ActivationReason {
  return {
    source: "policy",
    code: reason,
  };
}

function evaluateEvent(
  event: AthenaChannelEvent | AthenaPlatformNoticeEvent | AthenaInternalSignalEvent,
): ActivationReason {
  if (event.kind === "internal_signal") {
    return {
      source: "event",
      code: "internal_signal",
      detail: event.signalType,
    };
  }

  if (event.kind === "platform_notice") {
    return {
      source: "event",
      code: "platform_notice",
      detail: event.noticeType,
    };
  }

  return {
    source: "event",
    code: "channel_event",
    detail: event.eventType,
  };
}

export const Activation = {
  evaluate(batch: EventBatch): ActivationResult {
    const reasons: ActivationReason[] = [];

    for (const event of batch.events) {
      if (isMessageEvent(event)) {
        const heuristic = evaluateRuntimeWillingnessHeuristic(toHeuristicParams(event));
        reasons.push(toPolicyReason(heuristic?.reason ?? "no_trigger"));
        continue;
      }

      reasons.push(evaluateEvent(event));
    }

    return {
      batchId: batch.batchId,
      activated: reasons.some(
        (reason) =>
          reason.code === "direct_message" ||
          reason.code === "at_self" ||
          reason.code === "llm_judge" ||
          reason.code === "platform_notice" ||
          reason.code === "internal_signal",
      ),
      reasons,
    };
  },
};
