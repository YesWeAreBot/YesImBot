import { afterEach, expect, it, vi } from "vitest";

import type { ConversationReport } from "../src/logger/conversation-report";
import { ErrorReporter } from "../src/shared/errors";

const config = { enabled: true, pasteServiceUrl: "https://report.invalid/" };
const logger = {
    warn: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
    info: vi.fn<(...args: unknown[]) => void>(),
} as any;
const upload = (result = new Response(JSON.stringify({ url: "https://report.invalid/id" }))) => {
    const fetch = vi.fn<(_url: string, _init: RequestInit) => Promise<Response>>(async () => result);
    vi.stubGlobal("fetch", fetch);
    return fetch;
};
const dump = (fetch: ReturnType<typeof upload>) => String((fetch.mock.calls[0][1].body as FormData).get("c"));
const sample = (): ConversationReport => ({
    identities: [
        { kind: "user", id: "678901234" },
        { kind: "channel", id: "123456789" },
        { kind: "message", id: "222223456" },
    ],
    entries: [
        { timestamp: "now", kind: "request", data: { prompt: '<user id="678901234">样例</user><channel id="123456789"/>', apiKey: "sample-api-secret" } },
        { timestamp: "then", kind: "response", data: 'data: {"message_id":"222223456","user_id":"987651234"}\n\ndata: {"text":"987651234"}\n' },
        { timestamp: "after", kind: "log", data: { raw: "群 123456789，引用 222223456", containsCredential: "sample-api-secret" } },
    ],
    omitted: 0,
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

it("only captures conversation material when a reporting mode explicitly enables it", async () => {
    const fetch = upload();
    const current = vi.fn<() => ConversationReport>(sample);
    await new ErrorReporter(config, logger, undefined, [], current).report({ errorId: "error-1", error: new Error(), conversation: sample() });
    expect(current).not.toHaveBeenCalled();
    expect(dump(fetch)).not.toContain("样例");
});

it("consistently masks known and discovered identifiers across prompts, logs and raw SSE", async () => {
    const fetch = upload();
    const snapshot = sample();
    const saveLocal = vi.fn<(id: string, error: Error, conversation?: ConversationReport) => Promise<void>>(async () => {});
    await new ErrorReporter({ ...config, conversationDetails: "masked" }, logger, saveLocal, [], () => snapshot).report({
        errorId: "error-2",
        error: new Error("requester 678901234 on 123456789"),
    });
    const body = dump(fetch);
    for (const id of ["678901234", "123456789", "222223456", "987651234", "sample-api-secret"]) {
        expect(body).not.toContain(id);
        expect(JSON.stringify(saveLocal.mock.calls)).not.toContain(id);
    }
    expect(body).toContain("用户A");
    expect(body).toContain("用户B");
    expect(body).toContain("1xxx789");
    expect(body).toContain("2xxx456");
    expect(body).toContain("样例");
    expect(body).toContain("requester 用户A on 1xxx789");
    expect(snapshot.identities[0].id).toBe("678901234");
});

it("preserves raw conversation identifiers while keeping credentials protected", async () => {
    const fetch = upload();
    await new ErrorReporter({ ...config, conversationDetails: "raw" }, logger, undefined, [], sample).report({
        errorId: "error-3",
        error: new Error(),
    });
    expect(dump(fetch)).toContain("123456789");
    expect(dump(fetch)).toContain("987651234");
    expect(dump(fetch)).not.toContain("sample-api-secret");
});

it("correlates HTTP and malformed responses to their local error ID", async () => {
    upload(new Response("private HTTP body", { status: 503 }));
    const reporter = new ErrorReporter(config, logger);
    await reporter.report({ errorId: "error-http", error: new Error() });
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/error-http.*503/));
    expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining("private HTTP body"));

    upload(new Response("{}"));
    await reporter.report({ errorId: "error-url", error: new Error() });
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/error-url.*链接/));
});

it("does not follow or expose an upstream redirect and keeps network failure details bounded", async () => {
    const fetch = upload(Response.redirect("https://redirect.invalid/secret", 307));
    const reporter = new ErrorReporter(config, logger);
    expect(await reporter.report({ errorId: "error-redirect", error: new Error() })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual", signal: expect.any(AbortSignal) });
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/error-redirect.*307/));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("redirect.invalid");

    fetch.mockRejectedValueOnce(new TypeError("DNS failure URL has private data", { cause: { code: "ENOTFOUND" } }));
    await reporter.report({ errorId: "error-dns", error: new Error() });
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/error-dns.*ENOTFOUND/));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private data");
});
