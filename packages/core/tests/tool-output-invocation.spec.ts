import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Schema } from "koishi";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToolService } from "../src/extension/service";

const dirs: string[] = [];
afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
    const baseDir = await mkdtemp(path.join(tmpdir(), "yesimbot-invocation-"));
    dirs.push(baseDir);
    let generation = 0,
        allowed = true;
    const ctx = { baseDir, scope: { key: "output-test" }, filter: () => allowed } as any;
    const world = { l2_manager: { getHistoryGeneration: () => generation }, isChannelAllowed: () => allowed };
    const logger = { info() {}, warn() {}, error() {}, debug() {}, success() {} };
    const tools = new ToolService(ctx, { advanced: { maxRetry: 2 } } as any, { world, logging: { getLogger: () => logger } } as any);
    const session = { platform: "test", selfId: "bot", channelId: "group", userId: "u", isDirect: false } as any;
    return { tools, session, clear: () => generation++, revoke: () => (allowed = false) };
}
function register(tools: ToolService, execute: any) {
    tools.registerTool({ name: "probe", description: "test", parameters: Schema.object({}), execute });
}
describe("long tool invocation receipts", () => {
    it("keeps small output and failed receipts unchanged; admin invocation without Session stays unchanged", async () => {
        const { tools, session } = await fixture();
        for (const result of [
            { status: "success", result: { text: "small" } },
            { status: "error", error: { name: "Error", message: "x" }, result: "x".repeat(30000) },
        ]) {
            register(tools, async () => result);
            expect(await tools.invoke("probe", {}, session)).toBe(result);
        }
        const large = { status: "success", result: "x".repeat(30000) };
        register(tools, async () => large);
        expect(await tools.invoke("probe", {})).toBe(large);
    });
    it("archives successful payload only, preserving metadata and ignoring forged model session", async () => {
        const { tools, session } = await fixture();
        const source = { text: "单行🙂".repeat(12000) };
        register(tools, async () => ({ status: "success", result: source, metadata: { receipt: "completed" } }));
        const result = await tools.invoke("probe", { session: { channelId: "forged" } }, session);
        expect(result.status).toBe("success");
        expect(result.metadata.receipt).toBe("completed");
        expect(result.result.kind).toBe("tool-output-resource");
        let text = "",
            offset: number | null = 0;
        while (offset !== null) {
            const page = await tools.readToolOutput(session, { uri: result.result.uri, offset });
            text += page.text;
            offset = page.nextOffset;
        }
        expect(JSON.parse(text)).toEqual(source);
        await expect(tools.readToolOutput({ ...session, selfId: "other" }, { uri: result.result.uri })).rejects.toThrow(/scope/);
        expect((await tools.readToolOutput({ ...session, userId: "group-neighbor" }, { uri: result.result.uri })).text.length).toBeGreaterThan(0);
    });
    it("denies another private user even when the adapter reuses its private channel ID", async () => {
        const { tools, session } = await fixture();
        session.isDirect = true;
        register(tools, async () => ({ status: "success", result: "x".repeat(30000) }));
        const receipt = await tools.invoke("probe", {}, session);
        await expect(tools.readToolOutput({ ...session, userId: "someone-else" }, { uri: receipt.result.uri })).rejects.toThrow(/scope/);
    });
    it("rejects clear, revocation, identity mutation in flight without retrying completed execution", async () => {
        for (const change of ["clear", "revoke", "identity"]) {
            const f = await fixture();
            const execute = vi.fn(async () => {
                await Promise.resolve();
                if (change === "identity") f.session.channelId = "elsewhere";
                else f[change]();
                return { status: "success", result: "x".repeat(30000), metadata: { receipt: "done" } };
            });
            register(f.tools, execute);
            const result = await f.tools.invoke("probe", {}, f.session);
            expect(result.status).toBe("success");
            expect(result.result.kind).toBe("tool-output-unavailable");
            expect(result.metadata.payloadError.retryable).toBe(false);
            expect(execute).toHaveBeenCalledTimes(1);
        }
    });
    it("reports cyclic and non-JSON result serialization separately from execution status", async () => {
        const { tools, session } = await fixture();
        const cycle: any = {};
        cycle.self = cycle;
        for (const payload of [cycle, 1n, () => {}, { nested: () => {} }, NaN, Symbol("unsupported")]) {
            const execute = vi.fn(async () => ({ status: "success", result: payload }));
            register(tools, execute);
            const result = await tools.invoke("probe", {}, session);
            expect(result.status).toBe("success");
            expect(result.metadata.payloadError.name).toBe("ToolOutputError");
            expect(execute).toHaveBeenCalledTimes(1);
        }
    });
});

it("denies a tool-output URI from the same native Telegram topic ID in another guild", async () => {
    const { tools, session } = await fixture();
    Object.assign(session, { platform: "telegram", channelId: "7", guildId: "-10001" });
    register(tools, async () => ({ status: "success", result: "x".repeat(30000) }));
    const receipt = await tools.invoke("probe", {}, session);
    expect(receipt.result.kind).toBe("tool-output-resource");
    await expect(tools.readToolOutput({ ...session, guildId: "-10002" }, { uri: receipt.result.uri })).rejects.toThrow(/scope/);
    expect((await tools.readToolOutput(session, { uri: receipt.result.uri })).text.length).toBeGreaterThan(0);
});
