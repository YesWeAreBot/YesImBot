import type { Message } from "@xsai/shared-chat";

import { estimateTokensByRegex } from "../shared/utils/toolkit";

export interface ContextBudgetReport {
    capacity?: number;
    originalInputTokens: number;
    inputTokens: number;
    reservedOutputTokens: number;
    droppedMessages: number;
    reason: string;
    multimodal: boolean;
}
interface BudgetRequest {
    messages: Message[];
    [key: string]: unknown;
}
export class ContextBudgetError extends Error {
    constructor(public readonly report: ContextBudgetReport) {
        super("上下文容量无法容纳系统提示、最新轮次、工具定义和输出预留；请缩小上下文或切换更大模型。");
        this.name = "ContextBudgetError";
    }
}
function estimate(request: BudgetRequest): { tokens: number; multimodal: boolean } {
    let mediaTokens = 0;
    // Do not serialize/tokenize base64. These allowances are estimates, not provider token counts.
    const text = JSON.stringify(
        { messages: request.messages, tools: request.tools, functions: request.functions, response_format: request.response_format ?? request.responseFormat },
        (_key, value) => {
            if (value && typeof value === "object") {
                if (["image_url", "input_image", "image"].includes(value.type)) {
                    mediaTokens += value.image_url?.detail === "low" || value.detail === "low" ? 1024 : 4096;
                    return { type: value.type };
                }
                if (["input_audio", "audio", "video", "input_video"].includes(value.type)) {
                    mediaTokens += 16384;
                    return { type: value.type };
                }
            }
            return value;
        },
    );
    // The display estimator treats an entire ASCII word as one token. A byte-based
    // floor prevents long identifiers/encoded text from bypassing capacity checks.
    const textTokens = Math.max(estimateTokensByRegex(text), Math.ceil(Buffer.byteLength(text, "utf8") / 3));
    return { tokens: textTokens + request.messages.length * 8 + mediaTokens, multimodal: mediaTokens > 0 };
}
export function estimateContextTokens(request: BudgetRequest): number {
    return estimate(request).tokens;
}
export function budgetContext(request: BudgetRequest, capacity?: number): { messages: Message[]; report: ContextBudgetReport } {
    const original = estimate(request);
    const known = typeof capacity === "number" && Number.isFinite(capacity) && capacity > 0;
    const output = [request.maxTokens, request.max_tokens, request.maxCompletionTokens, request.max_completion_tokens].filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
    );
    const reserve = output.length ? Math.ceil(Math.max(...output)) : known ? Math.max(1, Math.min(4096, Math.floor(capacity * 0.1))) : 0;
    const report: ContextBudgetReport = {
        capacity: known ? capacity : undefined,
        originalInputTokens: original.tokens,
        inputTokens: original.tokens,
        reservedOutputTokens: reserve,
        droppedMessages: 0,
        reason: known ? "已在候选模型容量内" : "容量未知，保持原始请求",
        multimodal: original.multimodal,
    };
    if (!known || original.tokens + reserve <= capacity) return { messages: request.messages, report };

    // A user round includes the assistant call and every following tool result.
    // Keeping/deleting whole rounds never creates a dangling tool result.
    const rounds: number[][] = [];
    for (let index = 0; index < request.messages.length; index++) {
        const message = request.messages[index];
        if (message.role === "system" || (message.role as string) === "developer") continue;
        if (message.role === "user" || !rounds.length) rounds.push([]);
        rounds[rounds.length - 1].push(index);
    }
    const removed = new Set<number>();
    let messages = request.messages;
    // Last round is protected even when the caller provides assistant/tool continuation only.
    for (const round of rounds.slice(0, -1)) {
        round.forEach((index) => removed.add(index));
        messages = request.messages.filter((_message, index) => !removed.has(index));
        report.inputTokens = estimateContextTokens({ ...request, messages });
        report.droppedMessages = removed.size;
        report.reason = "超出容量，按时间顺序移除完整旧轮次；未修改原始历史";
        if (report.inputTokens + reserve <= capacity) return { messages, report };
    }
    report.reason = "系统提示、最新轮次和工具定义超过可用输入容量";
    throw new ContextBudgetError(report);
}
