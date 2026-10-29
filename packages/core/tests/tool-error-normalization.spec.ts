import { Schema } from "koishi";
import { describe, expect, it } from "vitest";

import { Failed, Success } from "../src/extension/helpers";
import { ToolService } from "../src/extension/service";
import { AppError, ErrorDefinitions, fromAppError, normalizeAppError, toToolError } from "../src/shared/errors";

describe("public tool error boundary", () => {
    it("keeps successful and legacy structured/string failures compatible", () => {
        expect(Success([])).toMatchObject({ status: "success", result: [] });
        expect(Failed("old message").error).toEqual({ name: "ToolError", message: "old message" });
        const legacy = { name: "OldError", message: "old", retryable: true };
        expect(Failed(legacy).error).toBe(legacy);
    });
    it("projects known fields with one ID and omits cause/context/stack", () => {
        const error = new AppError(ErrorDefinitions.LLM.TIMEOUT, { cause: new Error("secret"), context: { token: "secret" } });
        expect(fromAppError(error)).toMatchObject({ code: "LLM.TIMEOUT", category: "timeout", errorId: error.errorId, retryable: false });
        expect(JSON.stringify(fromAppError(error))).not.toMatch(/secret|cause|context|stack/);
        expect(toToolError(error)).toEqual(fromAppError(error));
    });
    it("retains unknown causes internally while redacting their public text", () => {
        const cause = new Error("Bearer sensitive-token\n at private/path");
        const normalized = normalizeAppError(cause);
        expect(normalized.cause).toBe(cause);
        expect(toToolError(cause)).toMatchObject({ code: "SYSTEM.UNKNOWN", category: "internal", retryable: false });
        expect(JSON.stringify(toToolError(cause))).not.toMatch(/sensitive-token|private\/path/);
    });
    it("validates cross-package envelopes instead of trusting arbitrary codes", () => {
        const error = new AppError(ErrorDefinitions.LLM.TIMEOUT);
        const envelope = { name: error.name, code: error.code, errorId: error.errorId, message: error.message, suggestion: error.suggestion };
        expect(toToolError(envelope).errorId).toBe(error.errorId);
        expect(toToolError({ code: error.code, message: "secret" }).code).toBe("SYSTEM.UNKNOWN");
        expect(toToolError({ ...envelope, errorId: "bad\nsecret" }).code).toBe("SYSTEM.UNKNOWN");
    });
    it.each([new Error("secret"), null, new AppError(ErrorDefinitions.LLM.TIMEOUT)])("normalizes thrown values without adding retries (%s)", async (error) => {
        let calls = 0;
        const tool = {
            parameters: Schema.object({}),
            execute: async () => {
                calls++;
                throw error;
            },
        };
        const service = {
            getTool: () => tool,
            _logger: { info() {}, warn() {}, error() {}, debug() {}, success() {} },
            config: { advanced: { maxRetry: 2 } },
            executeInvocation: ToolService.prototype["executeInvocation"],
            deps: {},
        } as unknown as ToolService;
        const result = await ToolService.prototype.invoke.call(service, "test", {}, {} as any);
        expect(result.status).toBe("error");
        expect(result.error?.code).toBe(error instanceof AppError ? error.code : "SYSTEM.UNKNOWN");
        expect(result.error?.message).not.toContain("secret");
        expect(calls).toBe(1);
    });
});

it("retains explicit legacy structured retry eligibility and attempt limits", async () => {
    for (const retryable of [false, true]) {
        let calls = 0;
        const legacy = Failed({ name: "Legacy", message: "original text", retryable });
        const tool = {
            parameters: Schema.object({}),
            execute: async () => {
                calls++;
                return legacy;
            },
        };
        const service = {
            getTool: () => tool,
            _logger: { info() {}, warn() {}, error() {}, debug() {}, success() {} },
            config: { advanced: { maxRetry: 2 } },
            executeInvocation: ToolService.prototype["executeInvocation"],
            deps: {},
        } as unknown as ToolService;
        const result = await ToolService.prototype.invoke.call(service, "legacy", {}, {} as any);
        expect(result).toBe(legacy);
        expect(calls).toBe(retryable ? 3 : 1);
    }
});

it("keeps local custom AppError identity and cause while projecting safe unknown public fields", () => {
    const cause = new Error("private-token");
    const error = new AppError({ code: "PLUGIN.LOCAL", message: "private-token", suggestion: "private-token" }, { cause });
    expect(normalizeAppError(error)).toBe(error);
    expect(normalizeAppError(error).cause).toBe(cause);
    expect(toToolError(error)).toMatchObject({ code: "SYSTEM.UNKNOWN", errorId: error.errorId, category: "internal", retryable: false });
    expect(JSON.stringify(toToolError(error))).not.toContain("private-token");
});
