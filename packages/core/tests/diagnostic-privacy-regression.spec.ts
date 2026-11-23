import { expect, it, vi } from "vitest";

import { LoggerService } from "../src/logger";
import { recordConversationReport, withConversationReport } from "../src/logger/conversation-report";
import { ErrorReporter, handleError, AppError, ErrorDefinitions } from "../src/shared/errors";
import { stubCtx } from "./helpers/yesimbot";
const sink = () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() });
it("masked diagnostic outside a conversation", async () => {
    const logger = sink();
    const fetch = vi.fn(async (_: string, init: RequestInit) => Response.json({ url: "https://invalid.test/ok" }));
    vi.stubGlobal("fetch", fetch);
    try {
        const reporter = new ErrorReporter(
            { enabled: true, includeSensitiveInfo: true, conversationDetails: "masked", pasteServiceUrl: "https://invalid.test" },
            logger as any,
        );
        const error = new AppError(ErrorDefinitions.SYSTEM.UNKNOWN, { context: { userId: "user-example-7890123", channelId: "10987654321" } });
        await reporter.report({ errorId: error.errorId, error });
        const posted = String((fetch.mock.calls[0][1].body as FormData).get("c"));
        expect(posted).not.toContain("user-example-7890123");
        expect(posted).not.toContain("10987654321");
    } finally {
        vi.unstubAllGlobals();
    }
});
it("console error cause masks configured provider secret", async () => {
    const logger = sink();
    const ctx = stubCtx({}, { logger: () => logger });
    const svc = new LoggerService(ctx, { logging: { level: 3 }, errorReporting: { enabled: false }, providers: [{ apiKey: "SYNTHETIC-CRED-456" }] } as any);
    handleError(svc.getLogger("test"), new Error("upstream failed using SYNTHETIC-CRED-456"), "test");
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain("SYNTHETIC-CRED-456");
    await svc.stop();
});

const entry = (kind: string, data: unknown) => ({ kind, data, timestamp: "2026-01-01T00:00:00Z" });

it.each([
    ["lite", false, false, false, false],
    ["low", true, false, false, false],
    ["medium", true, true, false, false],
    ["full", true, true, true, false],
    ["full-all", true, true, true, true],
] as const)("limits %s to the selected diagnostic data", async (level, detail, response, chat, system) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ url: "https://invalid.test/ok" }));
    vi.stubGlobal("fetch", fetch);
    try {
        const reporter = new ErrorReporter({ enabled: true, level, pasteServiceUrl: "https://invalid.test" }, sink() as any);
        await reporter.report({
            errorId: "fixture",
            error: new Error("specific-error-detail"),
            conversation: {
                omitted: 0,
                identities: [],
                entries: [
                    entry("model.response", { raw: "specific-response" }),
                    entry("conversation.input", {
                        channelId: "123456789",
                        messages: [{ userId: "987654321", messageId: "765432123", nickname: "nickname", content: "specific-dialogue" }],
                    }),
                    entry("model.request", { payload: { messages: [{ role: "system", content: "specific-system" }] } }),
                ],
            },
        });
        const report = String((fetch.mock.calls[0][1]?.body as FormData).get("c"));
        expect(report.includes("specific-error-detail")).toBe(detail);
        expect(report.includes("specific-response")).toBe(response);
        expect(report.includes("specific-dialogue")).toBe(chat);
        expect(report.includes("specific-system")).toBe(system);
        expect(report).not.toContain("987654321");
    } finally {
        vi.unstubAllGlobals();
    }
});

it("folds the first request in the Koishi console and expands the model response", async () => {
    const logger = sink();
    const ctx = stubCtx({}, { logger: () => logger });
    const service = new LoggerService(ctx, { logging: { level: 3, traceToConsole: true }, errorReporting: { enabled: false } } as any);
    const target = { platform: "onebot", selfId: "bot", channelId: "group" };
    withConversationReport(service.startConversationReport(target, "turn-1"), () => {
        recordConversationReport("model.request", { requestId: "request-1", payload: { system: "fixture-private-input" } });
        recordConversationReport("model.response", { requestId: "request-1", raw: "fixture-returned-output" });
    });
    const output = JSON.stringify(logger.debug.mock.calls);
    expect(output).toContain("……");
    expect(output).toContain("request-1");
    expect(output).toContain("fixture-returned-output");
    expect(output).not.toContain("fixture-private-input");
    await service.stop();
});
