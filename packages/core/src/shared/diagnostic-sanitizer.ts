const secretKey = /^(authorization|proxy-authorization|cookie|set-cookie|(?:x-)?api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret|token)$/i;

/** Shared credential filtering for local logs and outbound reports. */
export function redactDiagnosticText(text: string, secrets: readonly string[] = []): string {
    // Escape variants occur when JSON is embedded inside a message or serialized again.
    const variants = secrets.filter(Boolean).flatMap(secret => [secret, JSON.stringify(secret).slice(1, -1)])
        .sort((a, b) => b.length - a.length);
    for (const secret of variants) text = text.split(secret).join("[REDACTED]");
    const keys = "authorization|proxy-authorization|cookie|set-cookie|(?:x-)?api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret|token";
    return text
        .replace(new RegExp(`("(?:${keys})"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, "gi"), '$1"[REDACTED]"')
        .replace(new RegExp(`('(?:${keys})'\\s*:\\s*)'(?:\\\\.|[^'\\\\])*'`, "gi"), "$1'[REDACTED]'")
        .replace(new RegExp(`(\\b(?:${keys})\\s*[:=]\\s*)[^\\r\\n]+`, "gi"), "$1[REDACTED]")
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.\-]+/gi, "$1 [REDACTED]")
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

/** Includes non-enumerable Error fields, never mutates inputs, and bounds recursion. */
export function sanitizeDiagnostic(value: unknown, secrets: readonly string[] = [], seen = new Set<object>(), depth = 0): any {
    if (typeof value === "string") return redactDiagnosticText(value, secrets);
    if (typeof value === "bigint") return String(value);
    if (!value || typeof value !== "object") return value;
    if (depth > 20) return "[Depth limit]";
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    try {
        if (value instanceof Date) return value.toISOString();
        if (Array.isArray(value)) return value.map(item => sanitizeDiagnostic(item, secrets, seen, depth + 1));
        const keys = value instanceof Error
            ? [...new Set(["name", "message", "stack", "cause", ...Object.getOwnPropertyNames(value)])]
            : Object.keys(value);
        return Object.fromEntries(keys.map(key => {
            let cleaned: unknown;
            try { cleaned = secretKey.test(key) ? "[REDACTED]" : sanitizeDiagnostic(value[key], secrets, seen, depth + 1); }
            catch { cleaned = "[Unreadable]"; }
            return [redactDiagnosticText(key, secrets), cleaned];
        }));
    } finally { seen.delete(value); }
}
