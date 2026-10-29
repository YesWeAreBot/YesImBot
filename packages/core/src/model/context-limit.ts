export interface ContextCapacityRow {
    amount?: number;
    unit: "token" | "K" | "M";
}

/** A declared capacity is independent of runtime context trimming. */
export interface ContextLimitConfig {
    mode: "unset" | "custom" | "auto";
    value?: string | ContextCapacityRow[];
}

export interface ContextLimitResult {
    mode: ContextLimitConfig["mode"];
    status: "unset" | "known" | "unknown";
    tokens?: number;
    source?: string;
    checkedAt?: number;
    reason?: string;
}

/**
 * Decimal K/M units; accept finite positive capacities without rounding to integers.
 * Also validate declarations as a self-contained schema callback: Koishi serializes
 * callbacks for the console, so this function must not reference module helpers.
 */
export function parseContextLimit(value: string | ContextCapacityRow[]): number;
export function parseContextLimit(value: ContextLimitConfig): ContextLimitConfig;
export function parseContextLimit(input: string | ContextCapacityRow[] | ContextLimitConfig): number | ContextLimitConfig {
    const config = typeof input === "object" && !Array.isArray(input);
    if (config && input.mode !== "custom") return input;
    const value = config ? (input.value ?? "") : input;
    if (Array.isArray(value)) {
        const row = value[0];
        if (
            value.length !== 1 ||
            !row ||
            typeof row !== "object" ||
            typeof row.amount !== "number" ||
            !Number.isFinite(row.amount) ||
            row.amount <= 0 ||
            !["token", "K", "M"].includes(row.unit)
        )
            throw new Error("最大上下文需要一行有效数值与 token/K/M 单位");
        const tokens = row.amount * (row.unit === "K" ? 1000 : row.unit === "M" ? 1000000 : 1);
        if (!Number.isFinite(tokens) || tokens <= 0 || tokens > Number.MAX_SAFE_INTEGER) throw new Error("最大上下文必须换算为安全范围内的有限正数 token 数");
        return config ? input : tokens;
    }
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
    return config ? input : tokens;
}

/** Deserialize legacy capacities before the console selects the native table branch. */
export function contextCapacityRows(value: string): ContextCapacityRow[] {
    const match = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*([km]?)\s*$/i.exec(value);
    if (!match || match[1].length > 4096) throw new Error("最大上下文容量格式无效");
    const [whole, fraction = ""] = match[1].split(".");
    const unit = (match[2].toUpperCase() || "token") as ContextCapacityRow["unit"];
    const multiplier = unit === "K" ? 1000n : unit === "M" ? 1000000n : 1n;
    const amount = Number(match[1]);
    const tokens = amount * Number(multiplier);
    if (!Number.isFinite(tokens) || tokens <= 0 || BigInt(whole + fraction) * multiplier > BigInt(Number.MAX_SAFE_INTEGER) * 10n ** BigInt(fraction.length))
        throw new Error("最大上下文必须换算为安全范围内的有限正数 token 数");
    return [{ amount, unit }];
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
