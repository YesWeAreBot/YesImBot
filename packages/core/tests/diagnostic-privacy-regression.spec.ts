import { expect, it, vi } from "vitest";

import { LoggerService } from "../src/logger";
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
