// Outbound diagnostics use an allowlist: arbitrary strings may contain conversations
// even after credential filtering. Full errors remain available in local logging.
const numberFields = new Set([
    "httpStatus", "status", "statusCode", "attempt", "attempts", "attemptNumber", "maxAttempts", "retryCount",
    "retryAfterMs", "timeoutMs", "durationMs", "elapsedMs", "headersMs", "firstChunkMs", "bytes", "frames",
    "contentChars", "reasoningChars", "toolFrames", "errorFrames", "malformedFrames", "pendingLineChars",
    "prompt_tokens", "completion_tokens", "total_tokens", "reasoning_tokens", "cached_tokens",
]);
const booleanFields = new Set(["isStream", "done", "eof", "oversizedLine"]);
const containerFields = new Set(["streamDiagnostics", "usage"]);
const errorNames = new Set(["Error", "AppError", "AggregateError", "TypeError", "SyntaxError", "RangeError", "ReferenceError", "URIError", "EvalError", "AbortError", "TimeoutError", "XSAIError"]);

export function diagnosticId(value: unknown): string {
    return typeof value === "string" && (value === "[REDACTED]" || /^[A-Za-z0-9_-]{1,128}$/.test(value)) ? value : "[Omitted]";
}

export function diagnosticCode(value: unknown): string {
    return typeof value === "string" && /^[A-Z][A-Z0-9_.]{0,127}$/.test(value) ? value : "SYSTEM.UNKNOWN";
}

export function summarizeContext(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const summary: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (numberFields.has(key) && typeof item === "number" && Number.isFinite(item)) summary[key] = item;
        else if (booleanFields.has(key) && typeof item === "boolean") summary[key] = item;
        else if (key === "requestId" && typeof item === "string") summary[key] = diagnosticId(item);
        else if (key === "contentType" && typeof item === "string") {
            const type = item.split(";", 1)[0].trim().toLowerCase();
            if (["application/json", "text/event-stream", "text/plain"].includes(type)) summary[key] = type;
        } else if (key === "finishReason" && ["stop", "length", "tool_calls", "function_call", "content_filter"].includes(item as string)) summary[key] = item;
        else if (containerFields.has(key)) summary[key] = summarizeContext(item);
    }
    return summary;
}

/** Input is already cycle/depth-bounded by the shared credential sanitizer. */
export function summarizeError(value: any): unknown {
    if (!value || typeof value !== "object") return value === "[Circular]" || value === "[Depth limit]" ? value : undefined;
    const summary: Record<string, unknown> = {
        name: errorNames.has(value.name) ? value.name : "Error",
    };
    if (value.code) summary.code = diagnosticCode(value.code);
    if (value.context) summary.context = summarizeContext(value.context);
    if (value.cause) summary.cause = summarizeError(value.cause);
    if (Array.isArray(value.errors)) summary.errors = value.errors.map(summarizeError);
    return summary;
}
