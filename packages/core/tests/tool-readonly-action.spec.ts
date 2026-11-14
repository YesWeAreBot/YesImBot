import { Schema } from "koishi";
import { expect, it } from "vitest";

import { Extension, Tool } from "../src/extension/decorators";
import { ToolService } from "../src/extension/service";
import { loggingStub } from "./helpers/yesimbot";

it("binds action-level read policy to the extension and retries only its pure reads", async () => {
    const ctx: any = { on() {}, filter: () => true, logger: () => ({ warn() {} }) };
    const tools = new ToolService(ctx, { advanced: { maxRetry: 1, retryDelay: 0 } } as any, { logging: loggingStub() } as any);
    ctx.yesimbot = { tool: tools };
    @Extension({ name: "mixed", display: "mixed", description: "mixed", version: "1" })
    class Mixed {
        reads = new Set(["list"]);
        attempts = 0;
        constructor(
            public ctx: any,
            public config: any,
        ) {}
        @Tool({
            description: "mixed",
            parameters: Schema.object({ action: Schema.string().required() }),
            readOnly(this: Mixed, args: Record<string, unknown>) {
                return this.reads.has(args.action as string);
            },
        } as any)
        async person_memory() {
            this.attempts++;
            return { status: "error", error: { name: "TemporaryError", message: "retryable", retryable: true } };
        }
    }
    const mixed = new Mixed(ctx, {});
    for (const definition of (mixed as any).tools.values()) tools.registerTool(definition);
    try {
        await tools.invoke("person_memory", { action: "list" });
        expect(mixed.attempts).toBe(2);
        const write = await tools.invoke("person_memory", { action: "propose" });
        expect(mixed.attempts).toBe(3);
        expect(write.error?.retryable).toBe(false);
    } finally {
        await tools.stop();
    }
});

it("fails closed when an action read policy throws even on a background-capable tool", async () => {
    const ctx: any = { on() {}, filter: () => true };
    const tools = new ToolService(ctx, { advanced: { maxRetry: 2, retryDelay: 0 } } as any, { logging: loggingStub() } as any);
    let attempts = 0;
    tools.registerTool({
        name: "mixed",
        description: "test",
        parameters: Schema.object({}),
        background: true,
        readOnly: () => {
            throw new Error("policy unavailable");
        },
        execute: async () => {
            attempts++;
            return { status: "error", error: { name: "Error", message: "retryable", retryable: true } };
        },
    } as any);
    try {
        expect((await tools.invoke("mixed", {})).error?.retryable).toBe(false);
        expect(attempts).toBe(1);
    } finally {
        await tools.stop();
    }
});
