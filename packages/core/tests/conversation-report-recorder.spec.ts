import { expect, it } from "vitest";

import { ConversationReportRecorder, isConversationReportEnabled, recordConversationReport, withConversationReport } from "../src/logger/conversation-report";

const target = { platform: "onebot", selfId: "10123456", channelId: "10987654", userId: "19999888", messageId: "17777666" };

it("keeps earlier willingness and the failing turn without mixing simultaneous conversations or model bodies", async () => {
    const recorder = new ConversationReportRecorder();
    const otherInstance = new ConversationReportRecorder();
    const previous = recorder.start(target, "previous");
    const active = recorder.start(target, "active");
    const other = recorder.start({ ...target, channelId: "20987654" }, "other");
    withConversationReport(previous, () => {
        recordConversationReport("decision", { score: 13 });
        recordConversationReport("model.response", { raw: "previous response" });
    });

    const [report, otherReport] = await Promise.all([
        withConversationReport(active, async () => {
            await Promise.resolve();
            recordConversationReport("model.request", { prompt: "current prompt" });
            recordConversationReport("log", "wrong instance", otherInstance);
            return recorder.snapshot();
        }),
        withConversationReport(other, async () => {
            recordConversationReport("log", "other channel");
            await Promise.resolve();
            return recorder.snapshot();
        }),
    ]);
    expect(report?.entries.map(({ data }) => data)).toEqual([{ score: 13 }, { prompt: "current prompt" }]);
    expect(otherReport?.entries.map(({ data }) => data)).toEqual(["other channel"]);
    expect(recorder.snapshot()).toBeUndefined();
});

it("invalidates only matching captures and refuses late data after clearing history", () => {
    const recorder = new ConversationReportRecorder();
    const direct = recorder.start({ ...target, channelId: "opaque-dm", isDirect: true });
    const group = recorder.start(target);
    withConversationReport(direct, () => recordConversationReport("log", "cleared"));
    withConversationReport(group, () => recordConversationReport("log", "kept"));
    recorder.clear((_platform, _channel, isDirect) => isDirect);
    withConversationReport(direct, () => {
        expect(isConversationReportEnabled()).toBe(false);
        recordConversationReport("log", "late callback");
        expect(recorder.snapshot()).toBeUndefined();
    });
    withConversationReport(group, () => expect(recorder.snapshot()?.entries.map(({ data }) => data)).toEqual(["kept"]));
    const replacement = recorder.start({ ...target, channelId: "opaque-dm", isDirect: true });
    withConversationReport(replacement, () => expect(recorder.snapshot()).toBeUndefined());
});

it("uploads an opted-in trace through the owned logger even when console logs are disabled", async () => {
    const { LoggerService, LogLevel } = await import("../src/logger");
    const { handleError } = await import("../src/shared/errors");
    const { stubCtx } = await import("./helpers/yesimbot");
    const { vi } = await import("vitest");
    const consoleLogger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
    const ctx = stubCtx({}, { logger: () => consoleLogger });
    const service = new LoggerService(ctx, {
        logging: { level: LogLevel.SILENT },
        errorReporting: { enabled: true, conversationDetails: "masked", pasteServiceUrl: "https://report.invalid/" },
        providers: [],
    } as any);
    let resolveUpload!: (value: string) => void;
    const uploaded = new Promise<string>((resolve) => {
        resolveUpload = resolve;
    });
    vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
            resolveUpload(String((init.body as FormData).get("c")));
            return Response.json({ url: "https://report.invalid/test" });
        }),
    );
    try {
        const logger = service.getLogger("agent");
        const trace = service.startConversationReport(target, "test-turn");
        withConversationReport(trace, () => {
            logger.debug("意愿判定");
            recordConversationReport("model.request", { prompt: `<user id="${target.userId}">示例</user>` });
            recordConversationReport("model.response", { raw: "原始响应" });
            handleError(logger, new Error("terminal error"), "reply");
        });
        const body = await uploaded;
        expect(body).toContain("意愿判定");
        expect(body).toContain("原始响应");
        expect(body).toContain("用户A");
        expect(body).not.toContain(target.userId);
        expect(consoleLogger.debug).not.toHaveBeenCalled();
    } finally {
        await service.stop();
        vi.unstubAllGlobals();
    }
});
