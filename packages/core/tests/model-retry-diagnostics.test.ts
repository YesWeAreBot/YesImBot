import { expect, it } from "bun:test";
import { ChatModelSwitcher } from "../src/services/model/service";
import { Services } from "../src/shared/constants";
import { AppError, ErrorDefinitions } from "../src/shared/errors";

function setup(chat: (options: any) => Promise<any>, maxRetries = 1) {
    const logs: string[] = [];
    const logger: any = { extend: () => logger };
    for (const level of ["debug", "info", "warn", "error", "success"]) logger[level] = (message: string) => logs.push(message);
    const model: any = {
        id: "test-model", config: { retryPolicy: { maxRetries }, timeoutPolicy: { firstTokenTimeout: 2, totalTimeout: 3 } },
        chat, isVisionModel: () => false,
    };
    const switcher = new ChatModelSwitcher({ [Services.Logger]: { getLogger: () => logger } } as any,
        { name: "test", models: [{ providerName: "test", modelId: model.id }] }, () => model);
    return { switcher, logs };
}
const success = { text: "ok", usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }, finishReason: "stop" };
function rateLimited(retryAfterMs: number) {
    return new AppError(ErrorDefinitions.LLM.RATE_LIMIT_EXCEEDED, {
        cause: Object.assign(new Error("upstream rejected"), { name: "XSAIError" }),
        context: { httpStatus: 429, retryAfterMs },
    });
}

it("respects Retry-After and records retry diagnostics", async () => {
    const times: number[] = [];
    const { switcher, logs } = setup(async () => {
        times.push(Date.now());
        if (times.length === 1) throw rateLimited(620);
        return success;
    });
    expect(await switcher.chat({ messages: [] })).toBe(success);
    expect(times.length).toBe(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(610);
    expect(logs.some((line) => line.includes("HTTP: 429") && line.includes("LLM.RATE_LIMIT_EXCEEDED") && line.includes("XSAIError"))).toBe(true);
    expect(logs.some((line) => line.includes("620ms") && line.includes("重试"))).toBe(true);
    expect(logs.some((line) => line.includes("首字超时: 2s") && line.includes("总超时: 3s"))).toBe(true);
    expect(logs.some((line) => line.includes("Tokens: 5") && line.includes("stop"))).toBe(true);
});

it("external cancellation interrupts Retry-After waiting without a further request", async () => {
    let calls = 0;
    const controller = new AbortController();
    const { switcher } = setup(async () => {
        calls++;
        setTimeout(() => controller.abort(new Error("cancelled")), 20);
        throw rateLimited(2000);
    });
    const start = Date.now();
    await expect(switcher.chat({ messages: [], abortSignal: controller.signal })).rejects.toThrow("cancelled");
    expect(Date.now() - start).toBeLessThan(400);
    expect(calls).toBe(1);
});

it("abandons the model rather than retrying before an excessive Retry-After", async () => {
    let calls = 0;
    const { switcher, logs } = setup(async () => { calls++; throw rateLimited(300001); });
    const start = Date.now();
    await expect(switcher.chat({ messages: [] })).rejects.toBeInstanceOf(AppError);
    expect(calls).toBe(1);
    expect(Date.now() - start).toBeLessThan(200);
    expect(logs.some((line) => line.includes("Retry-After") && line.includes("放弃"))).toBe(true);
});

it("keeps the configured retry limit and reports exhaustion", async () => {
    let calls = 0;
    const { switcher, logs } = setup(async () => { calls++; throw rateLimited(Number.NaN); });
    await expect(switcher.chat({ messages: [] })).rejects.toBeInstanceOf(AppError);
    expect(calls).toBe(2);
    expect(logs.some((line) => line.includes("等待: 500ms"))).toBe(true);
    expect(logs.some((line) => line.includes("重试次数已耗尽"))).toBe(true);
    expect(logs.some((line) => line.includes("故障转移"))).toBe(true);
});
