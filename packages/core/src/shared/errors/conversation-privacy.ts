import type { ConversationReport } from "../../logger/conversation-report";

type IdentityKind = ConversationReport["identities"][number]["kind"];

const credential =
    /^(?:authorization|proxy-authorization|cookie|set-cookie|(?:x-)?api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret|token)$/i;

function identityKind(key: string): IdentityKind | undefined {
    const field = key
        .replace(/[^a-z]/gi, "")
        .toLowerCase()
        .replace(/ids$/, "id");
    if (/^(user|sender|author|requester|member|operator|recipient|targetuser)id$/.test(field)) return "user";
    if (/^(channel|guild|group|room|targetchannel)id$/.test(field)) return "channel";
    if (/^(message|msg|quote|quotedmessage|reply|anchor|source(?:message)?|trigger(?:message)?|sent(?:message)?|outbound(?:message)?)id$/.test(field))
        return "message";
    if (/^(bot|self)id$/.test(field)) return "bot";
}

function visit(value: unknown, inspect: (value: unknown, key: string) => void, key = "", seen = new Set<object>(), depth = 0): void {
    if (depth > 21) return;
    inspect(value, key);
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    for (const [field, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if ("value" in descriptor) visit(descriptor.value, inspect, Array.isArray(value) ? key : field, seen, depth + 1);
    }
}

/** Identify structured credentials and their copies in wire JSON and SSE. */
export function conversationReportSecrets(value: unknown, known: readonly string[]): string[] {
    const credentials = new Set(known);
    visit(value, (value, key) => {
        if (typeof value === "string" && credential.test(key) && value) credentials.add(value);
        if (typeof value !== "string" || (key && credential.test(key))) return;
        const source = value.replace(/\\+(?=["'])/g, "");
        for (const match of source.matchAll(/["']([\w-]+)["']\s*:\s*["']([^"'\r\n]+)["']/g)) {
            if (credential.test(match[1])) credentials.add(match[2]);
        }
    });
    return [...credentials];
}

function alphabetic(index: number): string {
    let result = "";
    for (let i = index + 1; i; i = Math.floor((i - 1) / 26)) result = String.fromCharCode(65 + ((i - 1) % 26)) + result;
    return result;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function conversationMask(report: ConversationReport, ...related: unknown[]): <T>(value: T) => T {
    const identities = new Map<string, IdentityKind>();
    const add = (id: unknown, kind: IdentityKind | undefined) => {
        if (!kind || (typeof id !== "string" && typeof id !== "number") || !id || id === "[REDACTED]") return;
        if (!identities.has(String(id))) identities.set(String(id), kind);
    };
    for (const { id, kind } of report.identities) add(id, kind);
    visit([report.entries, ...related], (value, key) => {
        add(value, identityKind(key));
        if (typeof value !== "string") return;

        const source = value.replace(/\\+(?=["'])/g, "");
        for (const match of source.matchAll(/["']?([\w-]+)["']?\s*[:=]\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|(\d+)(?![\w.]))/g)) {
            add(match[2] ?? match[3] ?? match[4], identityKind(match[1]));
        }
        for (const match of source.matchAll(/["']([\w-]*ids)["']\s*:\s*\[([^\]\r\n]*)\]/gi)) {
            for (const id of match[2].matchAll(/"([^"]+)"|'([^']+)'|(\d+)/g)) add(id[1] ?? id[2] ?? id[3], identityKind(match[1]));
        }
        const xmlKinds: Record<string, IdentityKind> = {
            at: "user",
            user: "user",
            member: "user",
            channel: "channel",
            guild: "channel",
            quote: "message",
            message: "message",
        };
        for (const match of source.matchAll(/<(at|user|member|channel|guild|quote|message)\b[^>]*?\sid\s*=\s*["']([^"'\r\n]+)["']/gi)) {
            add(match[2], xmlKinds[match[1].toLowerCase()]);
        }
    });

    let nextUser = 0;
    const replacements = new Map(
        [...identities].map(([id, kind]) => [id, kind === "user" ? `用户${alphabetic(nextUser++)}` : id.length > 4 ? `${id[0]}xxx${id.slice(-3)}` : "xxxx"]),
    );
    const matches = [...replacements.keys()].sort((a, b) => b.length - a.length).map(escaped);
    const pattern = matches.length ? new RegExp(`(?<![A-Za-z0-9_])(?:${matches.join("|")})(?![A-Za-z0-9_])`, "g") : undefined;
    const maskText = (value: string) => (pattern ? value.replace(pattern, (id) => replacements.get(id)!) : value);

    function mask(value: unknown): unknown {
        if (typeof value === "string") return maskText(value);
        if (typeof value === "number") return replacements.get(String(value)) ?? value;
        if (!value || typeof value !== "object") return value;
        if (Array.isArray(value)) return value.map(mask);
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [maskText(key), mask(item)]));
    }
    return (value) => mask(value) as typeof value;
}
