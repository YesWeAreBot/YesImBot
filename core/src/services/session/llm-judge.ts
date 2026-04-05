import { generateText } from "ai";
import type { Context } from "koishi";

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
