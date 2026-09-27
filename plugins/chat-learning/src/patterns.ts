import { generateText, jsonSchema, LanguageModel } from "koishi-plugin-yesimbot";

import { buildConversationChains } from "./links.js";
import { modelCacheId, type ModelCache } from "./model-cache.js";
import { asRecord, patternPhrase, sanitizeForDisplay } from "./text.js";
import type {
  ConversationSegment,
  InitiationIntent,
  InitiationPattern,
  LocalChainSample,
  MessageLink,
  MessageTurn,
  ResponseIntent,
  ResponsePattern,
} from "./types.js";

const RESPONSE_INTENTS = ["ack", "agree", "question", "joke", "roast", "empathy", "refuse"] as const;

const INITIATION_INTENTS = ["share", "question", "react", "recall", "opinion"] as const;

const ANNOTATION_ROLES = ["response", "initiation", "noise"] as const;

interface MessageAnnotation {
  id: string;
  role: (typeof ANNOTATION_ROLES)[number];
  intent: string;
}

/** Model output, so the SDK does not validate it for us; the prompt asks for JSON but cannot guarantee it. */
const modelOutputSchema = jsonSchema<{ messages?: MessageAnnotation[] }>(
  {
    type: "object",
    properties: {
      messages: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, role: { type: "string", enum: [...ANNOTATION_ROLES] }, intent: { type: "string" } },
          required: ["id", "role", "intent"],
        },
      },
    },
  },
  {
    validate: (value) => {
      const messages = asRecord(value)?.messages;
      if (messages === undefined) return { success: true, value: {} as { messages?: MessageAnnotation[] } };
      if (!Array.isArray(messages)) return { success: false, error: new TypeError("messages must be an array") };
      for (const item of messages) {
        const entry = asRecord(item);
        if (typeof entry?.id !== "string" || typeof entry.intent !== "string" || !ANNOTATION_ROLES.includes(entry.role as never)) {
          return { success: false, error: new TypeError("each annotation needs id: string, role: response|initiation|noise, intent: string") };
        }
      }
      return { success: true, value: value as { messages?: MessageAnnotation[] } };
    },
  },
);

const MAX_MODEL_MESSAGES = 80;

const MAX_MODEL_CHARS = 12_000;

export interface PatternSnapshot {
  readonly responsePatterns: readonly ResponsePattern[];
  readonly initiationPatterns: readonly InitiationPattern[];
}

export interface ClassifyModelOptions {
  readonly maxThreads?: number;
  readonly maxThreadMessages?: number;
}

interface ClassifyThread {
  readonly turns: readonly MessageTurn[];
}

export async function classifyPatternsWithModel(
  model: LanguageModel,
  turns: readonly MessageTurn[],
  segments: readonly ConversationSegment[],
  links: readonly MessageLink[] = [],
  options: ClassifyModelOptions = {},
  cache?: ModelCache,
): Promise<PatternSnapshot | undefined> {
  const key = cache?.key(["classify", modelCacheId(model), turns, segments, links, options]);
  const produce = async (): Promise<PatternSnapshot | undefined> => {
    const maxThreads = options.maxThreads ?? 3;
    const maxThreadMessages = options.maxThreadMessages ?? 30;
    const threads = selectClassifyThreads(segments, links, maxThreads, maxThreadMessages);
    if (threads.length === 0) return undefined;

    const { prompt, messageByPromptId } = buildThreadPrompt(threads);
    const system = [
      "你是一个群聊行为标注器。",
      "你会看到若干完整对话线程，请为线程中的每条消息标注 role 和 intent。",
      "role=response 表示消息是在回应前面某人的话，intent 从 agree|ack|question|joke|roast|empathy|refuse 中选择。",
      "role=initiation 表示消息是在发起新话题或开启新一轮对话，intent 从 share|question|react|recall|opinion 中选择。",
      "如果消息不适合作为发言风格样本，例如纯状态、无意义、命令、通知、纯媒体或无法判断，使用 role=noise。",
      "必须参考完整线程上下文判断，不要只根据单条消息猜测。",
      "id 必须原样返回，不要改写、遗漏或补充消息。",
      '只返回 JSON：{"messages":[{"id":"t0-m0","role":"response","intent":"agree"}]}',
      "不要输出其他内容。",
    ].join("\n");

    try {
      const { text } = await generateText({ model, system, prompt, temperature: 0.1 });
      return await parseModelAnnotations(text, messageByPromptId);
    } catch {
      return undefined;
    }
  };
  return cache && key ? cache.getOrProduce(key, produce) : produce();
}

export async function generateChainStyle(
  model: LanguageModel,
  chain: readonly string[],
  sample: LocalChainSample,
  cache?: ModelCache,
): Promise<string | undefined> {
  const key = cache?.key(["chain-style", modelCacheId(model), chain, sample]);
  const produce = async (): Promise<string | undefined> => {
    const sampleText = sample.turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n");
    const prompt = [
      "下面是一条真实群聊回复链：",
      `chain: ${chain.join(" -> ")}`,
      "sample:",
      sampleText,
      "",
      "请描述这条链的说话风格，按以下五个维度：",
      "语气：直接、反问、敷衍、认真、阴阳怪气等",
      "句式：短句、反问、排比、复读等",
      "节奏：先否定对方前提，再补论据，最后如何收束",
      "句长：单句大约多少字",
      "语言习惯：是否使用语气词、解释、道歉、感叹号",
      "只输出 60-120 字，不要总结具体内容、人名、链接或事实，不要输出标签或 JSON。",
    ].join("\n");

    try {
      const { text } = await generateText({ model, prompt, temperature: 0.2 });
      const style = text.trim().replace(/\s+/g, " ").slice(0, 120);
      return style.length > 0 ? style : undefined;
    } catch {
      return undefined;
    }
  };
  return cache && key ? cache.getOrProduce(key, produce) : produce();
}

export function sampleSignature(sample: LocalChainSample): string {
  return JSON.stringify(sample.turns);
}

function selectClassifyThreads(
  segments: readonly ConversationSegment[],
  links: readonly MessageLink[],
  maxThreads: number,
  maxThreadMessages: number,
): ClassifyThread[] {
  const candidates = buildConversationChains(segments, links)
    .map((chain) => ({ chain, score: threadScore(chain.turns) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  const threads: ClassifyThread[] = [];
  let totalMessages = 0;
  let totalChars = 0;
  for (const candidate of candidates) {
    if (threads.length >= maxThreads) break;
    const selectedTurns = candidate.chain.turns.slice(-maxThreadMessages);
    const chars = selectedTurns.reduce((sum, turn) => sum + sanitizeForDisplay(turn.text).trim().length, 0);
    if (totalMessages + selectedTurns.length > MAX_MODEL_MESSAGES) continue;
    if (totalChars + chars > MAX_MODEL_CHARS) break;
    threads.push({ turns: selectedTurns });
    totalMessages += selectedTurns.length;
    totalChars += chars;
  }
  return threads;
}

function threadScore(turns: readonly MessageTurn[]): number {
  const texts = turns.map((turn) => sanitizeForDisplay(turn.text).trim()).filter((text) => text.length > 0);
  if (texts.length < 2) return 0;
  const userIds = new Set(turns.map((turn) => turn.userId));
  const uniqueTexts = new Set(texts);
  const repetitionRatio = uniqueTexts.size / texts.length;
  if (repetitionRatio < 0.5) return 0;
  return turns.length + userIds.size * 2 + Math.min(uniqueTexts.size, 8);
}

function buildThreadPrompt(threads: readonly ClassifyThread[]): { readonly prompt: string; readonly messageByPromptId: ReadonlyMap<string, MessageTurn> } {
  const lines: string[] = [];
  const messageByPromptId = new Map<string, MessageTurn>();

  for (const [threadIndex, thread] of threads.entries()) {
    lines.push(`## conversation thread ${threadIndex}`);
    const userLabels = new Map<string, string>();
    for (const [messageIndex, turn] of thread.turns.entries()) {
      const id = `t${threadIndex}-m${messageIndex}`;
      messageByPromptId.set(id, turn);
      const text = sanitizeForDisplay(turn.text).trim();
      if (text.length === 0) continue;
      lines.push(`[${id}] [${speakerLabel(turn.userId, userLabels)}] ${text}`);
    }
  }

  return { prompt: lines.join("\n"), messageByPromptId };
}

function speakerLabel(userId: string, labels: Map<string, string>): string {
  const existing = labels.get(userId);
  if (existing !== undefined) return existing;
  const next = `u${labels.size}`;
  labels.set(userId, next);
  return next;
}

function byFrequency(left: { readonly frequency: number }, right: { readonly frequency: number }): number {
  return right.frequency - left.frequency;
}

async function parseModelAnnotations(text: string, messageByPromptId: ReadonlyMap<string, MessageTurn>): Promise<PatternSnapshot | undefined> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  if (!("messages" in parsed)) return undefined;

  const result = await modelOutputSchema.validate!(parsed);
  if (!result.success) return undefined;

  const responseCounts = new Map<string, { intent: ResponseIntent; phrase: string; sampleIds: string[] }>();
  const initiationCounts = new Map<string, { intent: InitiationIntent; phrase: string; sampleIds: string[] }>();

  for (const item of result.value.messages ?? []) {
    if (item.role === "noise") continue;
    const turn = messageByPromptId.get(item.id);
    if (!turn) continue;
    const phrase = patternPhrase(turn.text);
    if (phrase.length === 0) continue;

    if (item.role === "response") {
      if (!isResponseIntent(item.intent)) continue;
      const key = `${item.intent}:${phrase}`;
      const existing = responseCounts.get(key) ?? { intent: item.intent, phrase, sampleIds: [] };
      existing.sampleIds.push(turn.id);
      responseCounts.set(key, existing);
      continue;
    }

    if (!isInitiationIntent(item.intent)) continue;
    const key = `${item.intent}:${phrase}`;
    const existing = initiationCounts.get(key) ?? { intent: item.intent, phrase, sampleIds: [] };
    existing.sampleIds.push(turn.id);
    initiationCounts.set(key, existing);
  }

  return {
    responsePatterns: [...responseCounts.values()]
      .map((item) => ({ intent: item.intent, phrase: item.phrase, frequency: item.sampleIds.length, sampleIds: item.sampleIds.slice(0, 3) }))
      .sort(byFrequency),
    initiationPatterns: [...initiationCounts.values()]
      .map((item) => ({ intent: item.intent, phrase: item.phrase, frequency: item.sampleIds.length, sampleIds: item.sampleIds.slice(0, 3) }))
      .sort(byFrequency),
  };
}

function isResponseIntent(value: string): value is ResponseIntent {
  return (RESPONSE_INTENTS as readonly string[]).includes(value);
}

function isInitiationIntent(value: string): value is InitiationIntent {
  return (INITIATION_INTENTS as readonly string[]).includes(value);
}
