import { afterEach, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { AppError, ErrorDefinitions, ErrorReporter, initializeErrorReporter, handleError } from "../src/shared/errors";
import { LocalLogWriter, sanitizeLog } from "../src/services/logger/local-writer";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; initializeErrorReporter({ enabled: false }, logger); });
const logger = { warn() {}, error() {}, info() {}, debug() {} } as any;
function capture() {
    const dumps: string[] = [];
    globalThis.fetch = (async (_url, init) => {
        dumps.push(String((init!.body as FormData).get("c")));
        return new Response(JSON.stringify({ url: "https://report.invalid/test" }), { status: 200 });
    }) as typeof fetch;
    return dumps;
}
const config = { enabled: true, pasteServiceUrl: "https://report.invalid/" };
const reporter = (secrets: string[] = [], saveLocal?: any) => new ErrorReporter(config, logger, saveLocal, secrets);

it("redacts structured and textual credentials throughout uploaded errors", async () => {
    const dumps = capture();
    const cause = new Error('Authorization: Bearer header-secret\n{"apiKey":"json-secret"}\nCookie: session=cookie-secret');
    const error = new AppError(ErrorDefinitions.LLM.REQUEST_FAILED, {
        args: ["password=message-secret"], cause,
        context: { apiKey: "structured-secret", proxy: "https://user:url-secret@host.invalid/", httpStatus: 429 },
    });
    await reporter().report({ errorId: "safe-report-id", error, additionalInfo: { secret: "extra-secret" } });
    expect(dumps).toHaveLength(1);
    for (const secret of ["header-secret", "json-secret", "cookie-secret", "message-secret", "structured-secret", "url-secret", "extra-secret"])
        expect(dumps[0]).not.toContain(secret);
    expect(dumps[0]).toContain("LLM.REQUEST_FAILED");
    expect(dumps[0]).toContain("429");
});

it("redacts configured bare secrets including escaped values without changing inputs", async () => {
    const dumps = capture();
    const secret = 'configured-"key\\value';
    const error = new AppError(ErrorDefinitions.SYSTEM.UNKNOWN, { cause: new Error(secret), context: { requestId: secret, rawResponse: secret } });
    const initialStack = (error.cause as Error).stack;
    await reporter([secret]).report({ errorId: secret, error, additionalInfo: { requestId: secret } });
    expect(dumps).toHaveLength(1);
    expect(dumps[0]).not.toContain(secret);
    expect(dumps[0]).not.toContain(JSON.stringify(secret).slice(1, -1));
    expect(dumps[0]).toContain("[REDACTED]");
    expect(error.context!.rawResponse).toBe(secret);
    expect((error.cause as Error).stack).toBe(initialStack);
});

it("omits dialogue, model output, and arbitrary error text while retaining technical diagnostics", async () => {
    const dumps = capture();
    const error = new AppError(ErrorDefinitions.LLM.OUTPUT_PARSING_FAILED, {
        context: { rawResponse: "private-model-output", messages: [{ content: "private-conversation" }],
            arbitrary: "private-unknown-context", requestId: "req-safe-42", httpStatus: 502,
            streamDiagnostics: { frames: 2, contentChars: 100, usage: { total_tokens: 30, extension: "private-usage" } } },
        cause: new Error("private-cause-message"),
    });
    error.stack = "private-stack-content";
    await reporter().report({ errorId: "safe-id", error, additionalInfo: { requestId: "req-additional", prompt: "private-additional", httpStatus: 503 } });
    expect(dumps).toHaveLength(1);
    for (const marker of ["private-model-output", "private-conversation", "private-unknown-context", "private-usage", "private-cause-message", "private-stack-content", "private-additional"])
        expect(dumps[0]).not.toContain(marker);
    for (const marker of ["LLM.OUTPUT_PARSING_FAILED", "req-safe-42", "req-additional", "httpStatus", "502", "503", "frames", "total_tokens", "30", "插件版本", "时间 (UTC)"])
        expect(dumps[0]).toContain(marker);
});

it("handles nested non-enumerable Error causes, aggregate errors, and circular objects", async () => {
    const dumps = capture();
    const nested = new Error("password=nested-secret");
    Object.defineProperty(nested, "cause", { value: new Error("Bearer inner-secret"), configurable: true });
    const aggregate = new AggregateError([nested], "private-aggregate-text");
    const context: any = { httpStatus: 500, nested };
    context.self = context;
    const error = new AppError(ErrorDefinitions.SYSTEM.UNKNOWN, { context, cause: aggregate });
    Object.defineProperty(aggregate, "cause", { value: error });
    await reporter().report({ errorId: "circular-id", error, additionalInfo: context });
    expect(dumps).toHaveLength(1);
    for (const marker of ["nested-secret", "inner-secret", "private-aggregate-text"]) expect(dumps[0]).not.toContain(marker);
    expect(dumps[0]).toContain("AggregateError");
    expect(context.self).toBe(context);
    const cleaned = JSON.stringify(sanitizeLog(error));
    expect(cleaned).not.toContain("nested-secret");
    expect(cleaned).not.toContain("inner-secret");
    expect(cleaned).toContain("[Circular]");
});

it("uses configured secrets through the global reporter initialization path", async () => {
    const dumps = capture();
    const secret = "provider-config-secret";
    initializeErrorReporter(config, logger, undefined, [secret]);
    const error = new AppError(ErrorDefinitions.SYSTEM.UNKNOWN, { context: { requestId: secret } });
    handleError(logger, error, "test");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(dumps).toHaveLength(1);
    expect(dumps[0]).not.toContain(secret);
});

it("reports circular context through handleError without crashing the logging step", async () => {
    const dumps = capture();
    initializeErrorReporter(config, logger);
    const context: any = { httpStatus: 500 };
    context.self = context;
    const error = new AppError(ErrorDefinitions.SYSTEM.UNKNOWN, { context });
    expect(() => handleError(logger, error, "circular-context")).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(dumps).toHaveLength(1);
    expect(dumps[0]).toContain("500");
    expect(context.self).toBe(context);
});

it("shares credential filtering with real local files while preserving nested Error diagnostics", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "telemetry-local-redaction-"));
    const secret = 'configured-"local\\key';
    const writer = new LocalLogWriter(directory, { enabled: true, directory: "logs", level: 3, maxFileSizeMB: 1, maxFiles: 2, retentionDays: 7 }, () => {}, [secret]);
    const cause = new Error('Authorization: Bearer local-header\nCookie: local-cookie\n{"apiKey":"local-json"}\nhttps://u:local-url@host.invalid/');
    Object.defineProperty(cause, "cause", { value: new Error(secret) });
    const record: any = { error: new AggregateError([cause], "safe-local-message"), apiKey: "local-field", password: "local-password", safe: "local-diagnostic-preserved" };
    record.self = record;
    const originalStack = cause.stack;
    try {
        await writer.write(record);
        await writer.close();
        const names = await fs.readdir(writer.directory);
        const text = await fs.readFile(path.join(writer.directory, names[0]), "utf8");
        const parsed = JSON.parse(text);
        for (const marker of [secret, JSON.stringify(secret).slice(1, -1), "local-header", "local-cookie", "local-json", "local-url", "local-field", "local-password"])
            expect(text).not.toContain(marker);
        expect(parsed.error.name).toBe("AggregateError");
        expect(parsed.error.errors[0].message).toContain("[REDACTED]");
        expect(parsed.error.errors[0].cause.message).toBe("[REDACTED]");
        expect(parsed.error.errors[0].stack).toContain("[REDACTED]");
        expect(parsed.safe).toBe("local-diagnostic-preserved");
        expect(parsed.self).toBe("[Circular]");
        expect(cause.stack).toBe(originalStack);
        expect(record.apiKey).toBe("local-field");
        expect(record.self).toBe(record);
    } finally { await writer.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

it("keeps local saving active when remote reporting is disabled, with existing log behavior", async () => {
    const dumps = capture();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "telemetry-local-"));
    const secret = 'local-"configured-secret';
    const writer = new LocalLogWriter(directory, { enabled: true, directory: "logs", level: 3, maxFileSizeMB: 1, maxFiles: 2, retentionDays: 7 }, () => {}, [secret]);
    const error = new AppError(ErrorDefinitions.SYSTEM.UNKNOWN, { cause: new Error(secret), context: { rawResponse: "local-response-preserved", apiKey: "local-structured-secret" } });
    try {
        const disabled = new ErrorReporter({ enabled: false }, logger, (errorId, error) => writer.write({ errorId, error }));
        expect(await disabled.report({ errorId: "local-id", error })).toBeNull();
        await writer.close();
        const names = await fs.readdir(writer.directory);
        const text = await fs.readFile(path.join(writer.directory, names[0]), "utf8");
        expect(dumps).toHaveLength(0);
        expect(text).toContain("local-response-preserved");
        expect(text).toContain("local-id");
        expect(text).not.toContain(JSON.stringify(secret).slice(1, -1));
        expect(text).not.toContain("local-structured-secret");
        expect(text).toContain("[REDACTED]");
    } finally { await writer.close(); await fs.rm(directory, { recursive: true, force: true }); }
});
