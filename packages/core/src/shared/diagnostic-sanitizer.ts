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

/** Returns data only: custom JSON output is filtered, accessors are never invoked. */
export function sanitizeDiagnostic(value: unknown, secrets: readonly string[] = [], seen = new Set<object>(), depth = 0, jsonKey = ""): any {
    if (typeof value === "string") return redactDiagnosticText(value, secrets);
    if (typeof value === "bigint") return String(value);
    if (typeof value === "function") return "[Function]";
    if (!value || typeof value !== "object") return value;
    if (depth > 20) return "[Depth limit]";
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    try {
        if (value instanceof Date) return redactDiagnosticText(Date.prototype.toISOString.call(value), secrets);
        // Preserve existing enumerable toJSON diagnostics, but filter their result
        // here instead of letting JSON.stringify execute an unfiltered callback.
        if (!Array.isArray(value)) {
            const toJSON = Object.getOwnPropertyDescriptor(value, "toJSON");
            if (toJSON && (toJSON.enumerable || value instanceof Error) && "value" in toJSON && typeof toJSON.value === "function") {
                try { return sanitizeDiagnostic(toJSON.value.call(value, jsonKey), secrets, seen, depth + 1, jsonKey); }
                catch { return "[Unserializable]"; }
            }
        }
        const error = value instanceof Error;
        const keys = Array.isArray(value)
            ? Array.from({ length: value.length }, (_, index) => String(index))
            : error
                ? [...new Set(["name", "message", "stack", "cause", ...Object.getOwnPropertyNames(value)])]
                : Object.keys(value);
        const result = Array.isArray(value) ? [] : Object.create(null);
        for (const key of keys) {
            let cleaned: unknown;
            try {
                if (secretKey.test(key)) cleaned = "[REDACTED]";
                else {
                    let descriptor = Object.getOwnPropertyDescriptor(value, key);
                    // Error names normally live on the prototype. Read descriptors only,
                    // including inherited fields, so a caller's getter cannot run.
                    if (!descriptor && error) {
                        let prototype = Object.getPrototypeOf(value);
                        while (prototype && !descriptor) {
                            descriptor = Object.getOwnPropertyDescriptor(prototype, key);
                            prototype = Object.getPrototypeOf(prototype);
                        }
                    }
                    cleaned = descriptor && !("value" in descriptor)
                        ? "[Accessor]"
                        : sanitizeDiagnostic(descriptor?.value, secrets, seen, depth + 1, redactDiagnosticText(key, secrets));
                }
            } catch { cleaned = "[Unreadable]"; }
            result[redactDiagnosticText(key, secrets)] = cleaned;
        }
        return result;
    } finally { seen.delete(value); }
}
