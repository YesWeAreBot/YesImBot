// ============================================================================
// BUILT-IN ACTIVATORS
// ============================================================================

import { Activator, ContextCapability } from "./types";

/**
 * Keyword-based activator - enables tool when keywords appear in context.
 */
export function keywordActivator(
    keywords: string[],
    options?: {
        priority?: number;
        caseSensitive?: boolean;
        contextField?: string; // Which field to search (default: all)
    }
): Activator {
    return async ({ context, config }) => {
        // Get conversation context from metadata
        const metadata = context.get(ContextCapability.Metadata);
        const conversationText = metadata?.conversationContext || "";

        const searchText = options?.caseSensitive ? conversationText : conversationText.toLowerCase();

        const normalizedKeywords = options?.caseSensitive ? keywords : keywords.map((k) => k.toLowerCase());

        const found = normalizedKeywords.some((keyword) => searchText.includes(keyword));

        return {
            allow: found,
            priority: found ? (options?.priority ?? 5) : 0,
            hints: found ? [`Detected keywords: ${keywords.join(", ")}`] : [],
        };
    };
}

/**
 * Random activator - probabilistically enables tool.
 */
export function randomActivator(probability: number, priority?: number): Activator {
    return async () => {
        const allow = Math.random() < probability;
        return {
            allow,
            priority: allow ? (priority ?? 1) : 0,
            hints: allow ? [`Randomly activated (p=${probability})`] : [],
        };
    };
}

/**
 * Session requirement activator - ensures session is available.
 */
export function requireSession(reason?: string): Activator {
    return async ({ context }) => {
        const hasSession = context.has(ContextCapability.Session);
        return {
            allow: hasSession,
            hints: hasSession ? [] : [reason || "Requires active session"],
        };
    };
}

/**
 * Platform-specific activator.
 */
export function requirePlatform(platforms: string | string[], reason?: string): Activator {
    const platformList = Array.isArray(platforms) ? platforms : [platforms];
    return async ({ context }) => {
        const platform = context.get(ContextCapability.Platform);
        const allowed = platform && platformList.includes(platform);
        return {
            allow: !!allowed,
            hints: allowed ? [] : [reason || `Requires platform: ${platformList.join(" or ")}`],
        };
    };
}

/**
 * Time-based activator - enables tool during specific time windows.
 */
export function timeWindowActivator(
    windows: Array<{ start: string; end: string }>, // "HH:MM" format
    priority?: number
): Activator {
    return async ({ context }) => {
        const timestamp = context.get(ContextCapability.Timestamp) || new Date();
        const currentTime = `${timestamp.getHours().toString().padStart(2, "0")}:${timestamp.getMinutes().toString().padStart(2, "0")}`;

        const inWindow = windows.some(({ start, end }) => {
            return currentTime >= start && currentTime <= end;
        });

        return {
            allow: inWindow,
            priority: inWindow ? (priority ?? 3) : 0,
            hints: inWindow ? [`Active during time window`] : [],
        };
    };
}

/**
 * Composite activator - combines multiple activators with AND/OR logic.
 */
export function compositeActivator(activators: Activator[], mode: "AND" | "OR" = "AND"): Activator {
    return async (ctx) => {
        const results = await Promise.all(activators.map((a) => a(ctx)));

        if (mode === "AND") {
            const allAllow = results.every((r) => r.allow);
            return {
                allow: allAllow,
                priority: allAllow ? Math.max(...results.map((r) => r.priority ?? 0)) : 0,
                hints: results.flatMap((r) => r.hints || []),
            };
        } else {
            // OR mode
            const anyAllow = results.some((r) => r.allow);
            return {
                allow: anyAllow,
                priority: anyAllow ? Math.max(...results.map((r) => r.priority ?? 0)) : 0,
                hints: results.flatMap((r) => r.hints || []),
            };
        }
    };
}
