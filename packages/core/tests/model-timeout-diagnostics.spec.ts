import { expect, it } from "vitest";

import { ChatModel } from "../src/model/chat-model";
import { AppError, ErrorDefinitions } from "../src/shared/errors";

function model(error: Error) {
    const logs: string[] = [];
    const m: any = Object.create(ChatModel.prototype);
    Object.assign(m, {
        config: { modelId: "timeout-test", providerName: "provider", parameters: { stream: false } },
        buildChatOptions: (options: any) => options,
        _executeNonStream: async () => {
            throw error;
        },
    });
    Object.defineProperty(m, "logger", { value: { debug() {}, info() {}, error: (line: string) => logs.push(line) } });
    return { m, logs };
}

it("keeps the actual timeout duration when fetch replaces the signal reason with AbortError", async () => {
    const reason = Object.assign(new Error("first token timed out"), { name: "TimeoutError", duration: 15 });
    const controller = new AbortController();
    controller.abort(reason);
    const { m, logs } = model(new DOMException("aborted", "AbortError"));
    const error = await m.chat({ messages: [], stream: false, abortSignal: controller.signal }).catch((error: Error) => error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toContain("15 秒");
    expect(error.cause).toBe(reason);
    expect(logs.join("\n")).toContain("15s");
    expect(error.context.timeoutSeconds).toBe(15);
});

it("reports known upstream timeout duration without undefined", async () => {
    const { m } = model(Object.assign(new Error("timeout"), { name: "TimeoutError", duration: 60 }));
    await expect(m.chat({ messages: [], stream: false })).rejects.toThrow("60 秒");
});

it("uses an honest message when an upstream timeout has no duration", async () => {
    const { m } = model(new DOMException("upstream timeout", "TimeoutError"));
    const error = await m.chat({ messages: [], stream: false }).catch((error: Error) => error);
    expect(error.message).toContain("超时");
    expect(error.message).not.toMatch(/undefined|NaN/);
    expect(error.message).not.toMatch(/\d+ 秒/);
    expect(new AppError(ErrorDefinitions.LLM.TIMEOUT).message).not.toContain("undefined");
});
