import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Schema } from "koishi";
import { afterEach, expect, it } from "vitest";

import { ToolService } from "../src/extension/service";
import { loggingStub } from "./helpers/yesimbot";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(timeout = 1000) {
    const baseDir = await mkdtemp(path.join(tmpdir(), "yib-tool-boundaries-"));
    const ctx: any = { baseDir, scope: { key: "tool-boundaries" }, filter: () => true };
    const world: any = { isChannelAllowed: () => true, l2_manager: { getHistoryGeneration: () => 0 } };
    const tools = new ToolService(ctx, { advanced: { timeout, maxRetry: 3, retryDelay: 1 } } as any, { world, logging: loggingStub() } as any);
    cleanups.push(async () => {
        await tools.stop();
        await rm(baseDir, { recursive: true, force: true });
    });
    const session: any = { platform: "test", selfId: "bot", channelId: "group", userId: "user", isDirect: false };
    return { tools, session };
}
it("enforces registration owner filters for discovery and execution", async () => {
    const { tools, session } = await fixture();
    let authorized = false,
        calls = 0;
    const owner: any = { filter: () => authorized };
    (tools.registerTool as any)(
        {
            name: "owned",
            description: "owned",
            parameters: Schema.object({}),
            execute: async () => {
                calls++;
                return { status: "success" };
            },
        },
        owner,
    );
    expect(tools.getToolSchemas(session)).toEqual([]);
    expect((await tools.invoke("owned", {}, session)).status).toBe("error");
    expect(calls).toBe(0);
    authorized = true;
    expect(tools.getToolSchemas(session).map((tool) => tool.name)).toEqual(["owned"]);
    expect((await tools.invoke("owned", {}, session)).status).toBe("success");
    expect(calls).toBe(1);
});
it("bounds an ordinary tool, aborts its signal and never retries a timed out side effect", async () => {
    const { tools, session } = await fixture(15);
    let calls = 0,
        signal: AbortSignal | undefined,
        release!: (value: any) => void;
    tools.registerTool({
        name: "slow",
        description: "slow",
        parameters: Schema.object({}),
        execute: async (args) => {
            calls++;
            signal = args.toolContext?.signal;
            return new Promise((resolve) => {
                release = resolve;
            });
        },
    });
    const result = await Promise.race([tools.invoke("slow", {}, session), new Promise<null>((resolve) => setTimeout(() => resolve(null), 150))]);
    release({ status: "error", error: { name: "late", message: "late", retryable: true } });
    expect(result).toMatchObject({ status: "error", error: { name: "ToolTimeoutError", retryable: false } });
    expect(signal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toBe(1);
});
it("checks producer permissions and result revision again when reading an archived result", async () => {
    const { tools, session } = await fixture();
    let authorized = true,
        revision = 1;
    (tools.registerTool as any)(
        {
            name: "scoped_read",
            description: "read",
            parameters: Schema.object({}),
            isResultCurrent: (result: any) => result.metadata.revision === revision,
            execute: async () => ({ status: "success", result: "x".repeat(25000), metadata: { revision } }),
        },
        { filter: () => authorized },
    );
    const receipt = await tools.invoke("scoped_read", {}, session);
    const uri = receipt.result.uri;
    expect((await tools.readToolOutput(session, { uri })).metadata).toEqual({ revision: 1 });
    revision++;
    await expect(tools.readToolOutput(session, { uri })).rejects.toThrow(/expired|invalid|current|authorization/i);
    revision--;
    authorized = false;
    await expect(tools.readToolOutput(session, { uri })).rejects.toThrow(/expired|invalid|current|authorization/i);
});

it("prevents a timed-out extension from sending with its retained session", async () => {
    const { tools, session } = await fixture(10);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
        release = resolve;
    });
    let sends = 0,
        lateError: unknown;
    session.bot = {
        platform: "test",
        selfId: "bot",
        sendMessage: async () => {
            sends++;
            return ["sent"];
        },
    };
    let finished!: () => void;
    const done = new Promise<void>((resolve) => {
        finished = resolve;
    });
    tools.registerTool({
        name: "late-send",
        description: "late",
        parameters: Schema.object({}),
        execute: async ({ session }) => {
            await blocked;
            try {
                await session.bot.sendMessage("group", "late");
            } catch (error) {
                lateError = error;
            } finally {
                finished();
            }
            return { status: "success" };
        },
    });
    expect(await tools.invoke("late-send", {}, session)).toMatchObject({ status: "error", error: { name: "ToolTimeoutError" } });
    release();
    await done;
    expect(lateError).toMatchObject({ name: "AbortError" });
    expect(sends).toBe(0);
});
