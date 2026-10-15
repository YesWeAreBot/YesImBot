import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Message } from "@xsai/shared-chat";
import { expect, it } from "vitest";

import { budgetContext, ContextBudgetError, estimateContextTokens } from "../src/agent/context-budget";
import { ChatModel } from "../src/services/model/chat-model";
import { captureContextSnapshot } from "../src/services/model/context-snapshot";
import { getUsageLedger } from "../src/services/model/usage";
import { registerHistoryInspection } from "../src/services/worldstate/history-inspection";
import { Services } from "../src/shared/constants";

const user = (content: string): Message => ({ role: "user", content });

it("leaves requests unchanged when capacity is unknown", () => {
    const messages = [user("x".repeat(10000))];
    expect(budgetContext({ messages }).messages).toBe(messages);
});

it("removes oldest complete rounds and preserves system and latest user", () => {
    const system: Message = { role: "system", content: "keep system" };
    const messages = [system, user("old ".repeat(1000)), { role: "assistant", content: "old answer" } as Message, user("latest")];
    const result = budgetContext({ messages }, 500);
    expect(result.messages).toEqual([system, messages[3]]);
    expect(result.report.droppedMessages).toBe(2);
    expect(messages).toHaveLength(4);
    expect(result.report.inputTokens + result.report.reservedOutputTokens).toBeLessThanOrEqual(500);
});

it("keeps tool calls and all their results in the same removable round", () => {
    const messages = [
        user("old"),
        { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "lookup", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "a", content: "result ".repeat(1000) },
        user("latest"),
    ] as Message[];
    expect(budgetContext({ messages }, 500).messages).toEqual([messages[3]]);
});

it("rejects oversized protected context without cutting text or system instructions", () => {
    expect(() => budgetContext({ messages: [{ role: "system", content: "system ".repeat(1000) }, user("latest")] }, 500)).toThrow(ContextBudgetError);
    expect(() => budgetContext({ messages: [user("latest ".repeat(1000))] }, 500)).toThrow(/无法容纳/);
});

it("does not treat a very long unbroken word as a single budget token", () => {
    expect(() => budgetContext({ messages: [user("x".repeat(100000))] }, 1000)).toThrow(ContextBudgetError);
});

it("counts image parts with a bounded allowance rather than tokenizing base64", () => {
    const messages = [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(2000000)}` } }] }] as Message[];
    expect(estimateContextTokens({ messages })).toBeLessThan(10000);
    expect(estimateContextTokens({ messages })).toBeGreaterThan(1000);
    expect(() => budgetContext({ messages }, 1000)).toThrow(ContextBudgetError);
});

it("includes tool schema and explicit output reserve in the budget", () => {
    expect(() => budgetContext({ messages: [user("hi")], tools: [{ description: "schema ".repeat(1000) }], maxTokens: 100 }, 500)).toThrow(ContextBudgetError);
    expect(() => budgetContext({ messages: [user("hi")], maxTokens: 1000 }, 500)).toThrow(ContextBudgetError);
});

it("recalculates from original messages for each candidate model", async () => {
    const messages = [user("old ".repeat(1000)), user("latest")];
    const requests: any[] = [];
    const logger = Object.fromEntries(["debug", "info", "warn", "error", "success"].map((level) => [level, () => {}]));
    const ctx = { [Services.Logger]: { getLogger: () => logger } } as any;
    for (const capacity of [10000, 500]) {
        const model = new ChatModel(
            ctx,
            () => ({ baseURL: "https://budget.invalid/", apiKey: "test", model: "test" }),
            {
                modelId: "test",
                abilities: [],
                contextLimit: { mode: "custom", value: String(capacity) },
                parameters: { stream: false },
            },
            (async (_url: any, init: any) => {
                requests.push(JSON.parse(init.body));
                return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: {} }), {
                    headers: { "content-type": "application/json" },
                });
            }) as typeof fetch,
        );
        await model.chat({ messages });
    }
    expect(requests.map((row) => row.messages.length)).toEqual([2, 1]);
    expect(messages).toHaveLength(2);
    expect(requests[1]).not.toHaveProperty("contextBudget");
});

it("history.context exposes budget estimates and trimming reasons while details controls body visibility", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "budget-inspection-"));
    const ctx = { baseDir } as any;
    const ledger = getUsageLedger(ctx);
    try {
        const snapshot = await ledger.snapshot();
        const { report } = budgetContext({ messages: [user("old ".repeat(1000)), user("latest")] }, 500);
        captureContextSnapshot(ctx, { provider: "p", model: "m", contextBudget: report } as any, { messages: [user("PRIVATE BODY")] }, snapshot.period);
        const actions = new Map<string, Function>();
        const command = (name: string): any => {
            const instance = {
                subcommand: (suffix: string) => command(name + suffix),
                option: () => instance,
                action: (action: Function) => {
                    actions.set(name, action);
                    return instance;
                },
            };
            return instance;
        };
        registerHistoryInspection(ctx, command("history"));
        const invoke = (details: boolean) =>
            actions.get("history.context")!({
                source: `history.context --provider p${details ? " --details" : ""}`,
                session: { platform: "test", userId: "admin" },
            });
        const summary = await invoke(false);
        expect(summary).toContain("预算估算");
        expect(summary).toContain("移除 1 条");
        expect(summary).toContain("完整旧轮次");
        expect(summary).not.toContain("PRIVATE BODY");
        expect(await invoke(true)).toContain("PRIVATE BODY");
    } finally {
        await ledger.close();
        await rm(baseDir, { recursive: true, force: true });
    }
});
