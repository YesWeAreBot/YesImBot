import type { Context } from "koishi";
import { requestSystemOne } from "@yesimbot/shared-model";
import { Services } from "@/shared/constants";

/**
 * Jev（TypeSafe System One 模型）通用客户端。
 *
 * Jev 是 TypeSafe AI 的旗舰 System One 模型：向它发送 `state` + 类型化问题，
 * 直接返回结构化答案（类型化值 + 概率 + 置信度），无需文本生成与解析。
 * 本模块只做一件事：把 /systemone 请求和三种原语答案的解析收口，
 * 供接话意愿判断（typesafe.ts）与回复质量门禁（plugin/service.ts）复用。
 *
 * 文档：https://docs.typesafe.ai/introduction
 */

export interface JevConnection {
    apiKey: string;
    baseURL: string;
    model: string;
    timeoutMs: number;
    /** 留空时使用旧连接配置；指定后仅使用所选提供商。 */
    evaluationModel?: string;
}

export interface NoulAnswer {
    type: "noul";
    noul: number;
}

export interface ChoiceAnswer {
    type: "choice";
    choice: string;
    probabilities: Record<string, number>;
    confidence: number;
}

export interface ScoreAnswer {
    type: "score";
    score: number;
    legend?: Record<string, string>;
    probabilities: Record<string, number>;
    confidence: number;
}

export type SystemOneAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneQuestion {
    type: "noul" | "choice" | "score";
    instructions: string;
    criteria?: Record<string, string> | string[];
}

export interface SystemOneResult {
    model: string;
    answers: Record<string, SystemOneAnswer>;
}

/**
 * 调用 /systemone 并解析答案。
 * - 任一问题缺失或格式非法：该问题不出现在 `answers` 中（由调用方决定如何处理），不整体失败；
 * - 网络错误 / 超时 / 中止 / 响应不可用：返回 null；
 * - 本函数绝不抛出。
 */
export async function evaluateSystemOne(
    ctx: Context,
    conn: JevConnection | null,
    state: unknown,
    questions: Record<string, SystemOneQuestion>,
    signal?: AbortSignal,
): Promise<SystemOneResult | null> {
    if (!conn || signal?.aborted)
        return null;

    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, conn.timeoutMs);
    let onAbort: () => void;
    const cancelled = new Promise<null>((resolve) => {
        onAbort = () => resolve(null);
        controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
        const selected = conn.evaluationModel?.trim();
        const options = selected ? ctx.get(Services.Model)?.getEvaluationModel(selected) : conn;
        if (!options || !options.apiKey.trim() || (!selected && !ctx.http))
            return null;
        const response = await Promise.race([requestSystemOne(options, { state, questions }, {
            signal: controller.signal,
            timeoutMs: conn.timeoutMs,
            post: selected ? undefined : (url, body, options) => ctx.http.post(url, body, options),
        }), cancelled]) as { model?: unknown; answers?: unknown } | null;
        if (controller.signal.aborted)
            return null;
        if (!response?.answers || typeof response.answers !== "object")
            return null;

        const answers: Record<string, SystemOneAnswer> = {};
        for (const [key, question] of Object.entries(questions)) {
            const raw = (response.answers as Record<string, unknown>)[key];
            const parsed = parseAnswer(question, raw);
            if (parsed)
                answers[key] = parsed;
        }
        return {
            model: typeof response.model === "string" ? response.model : options.model,
            answers,
        };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        controller.signal.removeEventListener("abort", onAbort!);
    }
}

function parseAnswer(question: SystemOneQuestion, raw: unknown): SystemOneAnswer | undefined {
    if (!raw || typeof raw !== "object")
        return undefined;
    const answer = raw as Record<string, unknown>;
    if (answer.type !== question.type)
        return undefined;

    switch (question.type) {
        case "noul": {
            const noul = answer.noul;
            if (typeof noul !== "number" || !Number.isFinite(noul) || noul < 0 || noul > 1)
                return undefined;
            return { type: "noul", noul };
        }
        case "choice": {
            const choice = answer.choice;
            const confidence = answer.confidence;
            if (typeof choice !== "string" || typeof confidence !== "number"
                || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
                return undefined;
            }
            return {
                type: "choice",
                choice,
                confidence,
                probabilities: asProbabilityMap(answer.probabilities),
            };
        }
        case "score": {
            const score = answer.score;
            const confidence = answer.confidence;
            if (typeof score !== "number" || !Number.isFinite(score)
                || typeof confidence !== "number" || !Number.isFinite(confidence)
                || confidence < 0 || confidence > 1) {
                return undefined;
            }
            return {
                type: "score",
                score,
                confidence,
                legend: asStringMap(answer.legend),
                probabilities: asProbabilityMap(answer.probabilities),
            };
        }
    }
}

function asProbabilityMap(value: unknown): Record<string, number> {
    if (!value || typeof value !== "object")
        return {};
    const map: Record<string, number> = {};
    for (const [key, prob] of Object.entries(value as Record<string, unknown>)) {
        if (typeof prob === "number" && Number.isFinite(prob) && prob >= 0 && prob <= 1)
            map[key] = prob;
    }
    return map;
}

function asStringMap(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== "object")
        return undefined;
    const map: Record<string, string> = {};
    for (const [key, text] of Object.entries(value as Record<string, unknown>)) {
        if (typeof text === "string")
            map[key] = text;
    }
    return Object.keys(map).length > 0 ? map : undefined;
}

/**
 * Noul 答案的伪置信度：越接近 0.5 越不确定。
 * 官方仅对 Choice/Score 返回原生 confidence，Noul 用距 0.5 的距离作为代理。
 */
export function noulConfidence(noul: number): number {
    return Math.abs(noul - 0.5) * 2;
}
