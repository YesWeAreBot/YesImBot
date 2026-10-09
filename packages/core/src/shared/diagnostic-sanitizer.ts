const secretKey =
    /^(authorization|proxy-authorization|cookie|set-cookie|(?:x-)?api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret|token)$/i;

export interface DiagnosticPrivacyOptions {
    partialCredentials?: boolean;
    includeCookies?: boolean;
    credentialValues?: ReadonlyArray<{ key: string; value: string }>;
}

/** Short credentials never expose their entire value. */
export function maskDiagnosticCredential(value: string): string {
    return value.length > 8 ? value.slice(0, 4) + "*".repeat(value.length - 8) + value.slice(-4) : "*".repeat(value.length);
}

function redactCredential(key: string, value: unknown, options: DiagnosticPrivacyOptions): string {
    if (!options.partialCredentials || typeof value !== "string") return "[REDACTED]";
    if (/^(cookie|set-cookie)$/i.test(key)) return options.includeCookies ? maskDiagnosticCredential(value) : "[REDACTED]";
    if (/^(password|secret|client[_-]?secret)$/i.test(key)) return "[REDACTED]";
    if (/^(authorization|proxy-authorization)$/i.test(key)) {
        const match = /^(Bearer|Basic)\s+(.+)$/i.exec(value);
        return match ? `${match[1]} ${maskDiagnosticCredential(match[2])}` : maskDiagnosticCredential(value);
    }
    return maskDiagnosticCredential(value);
}

/** Shared credential filtering for local logs and outbound reports. */
export function redactDiagnosticText(text: string, secrets: readonly string[] = [], options: DiagnosticPrivacyOptions = {}): string {
    // Escape variants occur when JSON is embedded inside a message or serialized again.
    const credentials = [...(options.credentialValues || []), ...secrets.filter(Boolean).map((value) => ({ key: "apiKey", value }))];
    const variants = credentials
        .flatMap(({ key, value }) => {
            const replacement = redactCredential(key, value, options);
            return [
                { value, replacement },
                { value: JSON.stringify(value).slice(1, -1), replacement: JSON.stringify(replacement).slice(1, -1) },
            ];
        })
        .filter((item) => item.value)
        .sort((a, b) => b.value.length - a.value.length || Number(b.replacement === "[REDACTED]") - Number(a.replacement === "[REDACTED]"));
    for (const { value, replacement } of variants) text = text.split(value).join(replacement);
    const keys =
        "authorization|proxy-authorization|cookie|set-cookie|(?:x-)?api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret|token";
    if (options.partialCredentials) {
        // Decode quoted JSON values before masking so escape forms cannot expose credentials.
        return text
            .replace(new RegExp(`("(${keys})"\\s*:\\s*)("(?:\\\\.|[^"\\\\])*")`, "gi"), (_, prefix, key, raw) => {
                try {
                    return prefix + JSON.stringify(redactCredential(key, JSON.parse(raw), options));
                } catch {
                    return prefix + '"[REDACTED]"';
                }
            })
            .replace(new RegExp(`('(${keys})'\\s*:\\s*)'([^']*)'`, "gi"), (_, prefix, key, value) => prefix + "'" + redactCredential(key, value, options) + "'")
            .replace(/(\b(cookie|set-cookie)\s*[:=]\s*)([^\r\n"'}]+)/gi, (_, prefix, key, value) => prefix + redactCredential(key, value.trim(), options))
            .replace(
                new RegExp(`(\\b(${keys})\\s*[:=]\\s*)([^\\r\\n,;"'}]+)`, "gi"),
                (_, prefix, key, value) => prefix + redactCredential(key, value.trim(), options),
            )
            .replace(/\b(Bearer|Basic)\s+([A-Za-z0-9+/_=.\-*]+)/gi, (_, scheme, value) => scheme + " " + maskDiagnosticCredential(value))
            .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
    }
    return text
        .replace(new RegExp(`("(?:${keys})"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, "gi"), '$1"[REDACTED]"')
        .replace(new RegExp(`('(?:${keys})'\\s*:\\s*)'(?:\\\\.|[^'\\\\])*'`, "gi"), "$1'[REDACTED]'")
        .replace(new RegExp(`(\\b(?:${keys})\\s*[:=]\\s*)[^\\r\\n]+`, "gi"), "$1[REDACTED]")
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, "$1 [REDACTED]")
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

/** Also redact copies of structured credentials in free-text error messages. */
function collectCredentialValues(value: unknown, seen = new Set<object>(), depth = 0): Array<{ key: string; value: string }> {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 20) return [];
    seen.add(value);
    const result: Array<{ key: string; value: string }> = [];
    try {
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
            if (!("value" in descriptor)) continue;
            if (secretKey.test(key) && typeof descriptor.value === "string" && descriptor.value) {
                result.push({ key, value: descriptor.value });
            } else result.push(...collectCredentialValues(descriptor.value, seen, depth + 1));
        }
    } catch {
        /* Unreadable objects are handled by the sanitizer below. */
    }
    return result;
}

/** Returns data only: custom JSON output is filtered, accessors are never invoked. */
export function sanitizeDiagnostic(
    value: unknown,
    secrets: readonly string[] = [],
    seen = new Set<object>(),
    depth = 0,
    jsonKey = "",
    options: DiagnosticPrivacyOptions = {},
): any {
    if (depth === 0 && options.partialCredentials) {
        options = { ...options, credentialValues: collectCredentialValues(value) };
    }
    if (typeof value === "string") return redactDiagnosticText(value, secrets, options);
    if (typeof value === "bigint") return String(value);
    if (typeof value === "function") return "[Function]";
    if (!value || typeof value !== "object") return value;
    if (depth > 20) return "[Depth limit]";
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    try {
        if (value instanceof Date) return redactDiagnosticText(Date.prototype.toISOString.call(value), secrets, options);
        // Preserve existing enumerable toJSON diagnostics, but filter their result
        // here instead of letting JSON.stringify execute an unfiltered callback.
        if (!Array.isArray(value)) {
            const toJSON = Object.getOwnPropertyDescriptor(value, "toJSON");
            if (toJSON && (toJSON.enumerable || value instanceof Error) && "value" in toJSON && typeof toJSON.value === "function") {
                try {
                    return sanitizeDiagnostic(toJSON.value.call(value, jsonKey), secrets, seen, depth + 1, jsonKey, options);
                } catch {
                    return "[Unserializable]";
                }
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
                if (secretKey.test(key)) {
                    const descriptor = Object.getOwnPropertyDescriptor(value, key);
                    cleaned = redactCredential(key, descriptor && "value" in descriptor ? descriptor.value : undefined, options);
                } else {
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
                    cleaned =
                        descriptor && !("value" in descriptor)
                            ? "[Accessor]"
                            : sanitizeDiagnostic(descriptor?.value, secrets, seen, depth + 1, redactDiagnosticText(key, secrets, options), options);
                }
            } catch {
                cleaned = "[Unreadable]";
            }
            result[options.partialCredentials && secretKey.test(key) ? key : redactDiagnosticText(key, secrets, options)] = cleaned;
        }
        return result;
    } finally {
        seen.delete(value);
    }
}
