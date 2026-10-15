/** A declared capacity is independent of runtime context trimming. */
export interface ContextLimitConfig {
    mode: "unset" | "custom" | "auto";
    value?: string;
}

export interface ContextLimitResult {
    mode: ContextLimitConfig["mode"];
    status: "unset" | "known" | "unknown";
    tokens?: number;
    source?: string;
    checkedAt?: number;
    reason?: string;
}

/** Decimal K/M units; accept finite positive capacities without rounding to integers. */
export function parseContextLimit(value: string): number {
    const match = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*([km]?)\s*$/i.exec(value);
    if (!match) throw new Error("最大上下文必须是正数或带 K/M 的容量，例如 131072.5、128K、1M");
    if (match[1].length > 4096) throw new Error("最大上下文数值过长");
    const [whole, fraction = ""] = match[1].split(".");
    const multiplier = match[2].toLowerCase() === "k" ? 1000n : match[2].toLowerCase() === "m" ? 1000000n : 1n;
    const numerator = BigInt(whole + fraction) * multiplier;
    const denominator = 10n ** BigInt(fraction.length);
    const tokens = Number(match[1]) * Number(multiplier);
    if (!Number.isFinite(tokens) || tokens <= 0 || numerator > BigInt(Number.MAX_SAFE_INTEGER) * denominator) {
        throw new Error("最大上下文必须换算为安全范围内的有限正数 token 数");
    }
    return tokens;
}

/** Only explicit total context fields are accepted, never output limits or names. */
export function readContextLimitMetadata(payload: unknown, modelId: string): { tokens: number; field: string } | undefined {
    if (!payload || typeof payload !== "object") return;
    const root = payload as Record<string, unknown>;
    const rows = Array.isArray(root.data) ? root.data : Array.isArray(root.models) ? root.models : [];
    const model = rows.find((row) => row && typeof row === "object" && (row.id === modelId || row.model === modelId));
    if (!model) return;
    const fields = ["context_length", "context_window", "max_context_length", "max_context_tokens"];
    for (const field of fields) {
        const value = model[field];
        if (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER) return { tokens: value, field };
    }
}

/** Append only the models route; preserve the configured prefix and query. */
export function contextMetadataURL(baseURL: string | URL): URL {
    const url = new URL(baseURL);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported API protocol");
    url.pathname = `${url.pathname.replace(/\/$/, "")}/models`;
    return url;
}
