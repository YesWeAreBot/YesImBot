import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { HISTORY_CHANNELS } from "../src/services/worldstate/channel-metadata";
import { HistoryCommandManager } from "../src/services/worldstate/commands";
import { InteractionManager } from "../src/services/worldstate/interaction-manager";
import { SemanticMemoryManager } from "../src/services/worldstate/l2-semantic-memory";
import { Services } from "../src/shared/constants";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "yib-history-clear-"));
    roots.push(root);
    const logRoot = path.join(root, "data/yesimbot/interactions");
    const files = ["qq/private_alice.agent.jsonl", "qq/group.agent.jsonl", "onebot/private_bob.agent.jsonl", "onebot/group.agent.jsonl"];
    for (const file of files) {
        await fs.mkdir(path.dirname(path.join(logRoot, file)), { recursive: true });
        const [platform, name] = file.split("/");
        const channelId = name.replace(".agent.jsonl", "").replace(/^private_/, "private:");
        await fs.writeFile(path.join(logRoot, file), JSON.stringify({ type: "agent_thought", platform, channelId }) + "\n");
    }
    await fs.writeFile(path.join(logRoot, "qq/keep.txt"), "unrelated");
    const removals: any[] = [];
    const actions = new Map<string, Function>();
    const logger = { info() {}, error() {}, warn() {} };
    // src 依据 HISTORY_CHANNELS 表判定频道类型（history.clear -a 与 Agent 日志归属保护）。
    const channels = [
        { platform: "qq", channelId: "private:alice", channelType: "private" },
        { platform: "qq", channelId: "group", channelType: "guild" },
        { platform: "onebot", channelId: "private:bob", channelType: "private" },
        { platform: "onebot", channelId: "group", channelType: "guild" },
    ];
    const command = (name: string): any => {
        const instance = {
            subcommand: (suffix: string) => command(name + suffix),
            option: () => instance,
            usage: () => instance,
            example: () => instance,
            action: (callback: Function) => {
                actions.set(name, callback);
                return instance;
            },
        };
        return instance;
    };
    const ctx: any = {
        baseDir: root,
        [Services.Logger]: { getLogger: () => logger },
        logger,
        command,
        database: {
            get: async (table: string, query: { channelType?: string } = {}) =>
                (table === HISTORY_CHANNELS ? channels : []).filter((row) => !query.channelType || row.channelType === query.channelType),
            remove: async (table: string, query: any) => {
                removals.push({ table, query });
                return { removed: 1 };
            },
        },
    };
    const manager = new InteractionManager(ctx, {} as any);
    const memory = new SemanticMemoryManager(ctx, { l2_memory: { enabled: false } } as any);
    new HistoryCommandManager(ctx, { l1_manager: manager, l2_manager: memory } as any, {} as any).register();
    const invoke = (options: any = {}) => actions.get("history.clear")!({ session: { platform: "qq", channelId: "group" }, options });
    const exists = async (file: string) =>
        fs.access(path.join(logRoot, file)).then(
            () => true,
            () => false,
        );
    return { manager, invoke, exists, files, removals, logRoot };
}

for (const type of ["private", "guild", "all"]) {
    it(`history.clear -a ${type} keeps agent logs outside its scope`, async () => {
        const { invoke, exists, files, removals } = await fixture();
        expect(await invoke({ all: type })).toContain("操作成功");
        for (const file of files) {
            const selected = type === "all" || (type === "private") === file.includes("/private_");
            expect(await exists(file)).toBe(!selected);
        }
        if (type !== "all") expect(await exists("qq/keep.txt")).toBe(true);
        expect(removals).toHaveLength(4);
        if (type === "private")
            expect(removals[0].query.$or).toEqual(
                expect.arrayContaining([
                    { platform: "qq", channelId: "private:alice" },
                    { platform: "onebot", channelId: "private:bob" },
                ]),
            );
        if (type === "guild")
            expect(removals[0].query.$or).toEqual(
                expect.arrayContaining([
                    { platform: "qq", channelId: "group" },
                    { platform: "onebot", channelId: "group" },
                ]),
            );
    });
}

for (const type of ["typo", "", "PRIVATE", null]) {
    it(`rejects invalid history type ${String(type)} before deleting anything`, async () => {
        const { invoke, exists, files, removals } = await fixture();
        expect(await invoke({ all: type })).toContain("错误");
        expect(removals).toEqual([]);
        for (const file of files) expect(await exists(file)).toBe(true);
    });
}

it("current-channel cleanup preserves private and other-platform agent logs", async () => {
    const { invoke, exists, files } = await fixture();
    await invoke();
    for (const file of files) expect(await exists(file)).toBe(file !== "qq/group.agent.jsonl");
});
it("platform cleanup retains logs on other platforms", async () => {
    const { manager, exists, files } = await fixture();
    await manager.clearAgentHistory("qq");
    for (const file of files) expect(await exists(file)).toBe(file.startsWith("onebot/"));
});
it("typed platform cleanup preserves the other type and other platforms", async () => {
    const { manager, exists, files } = await fixture();
    await (manager.clearAgentHistory as any)("qq", undefined, "private");
    for (const file of files) expect(await exists(file)).toBe(file !== "qq/private_alice.agent.jsonl");
});
it("manager rejects unknown types before filesystem deletion", async () => {
    const { manager, exists, files } = await fixture();
    await expect((manager.clearAgentHistory as any)(undefined, undefined, "typo")).rejects.toThrow();
    for (const file of files) expect(await exists(file)).toBe(true);
});
it("explicit platform and channel cleanup retains same channel on another platform", async () => {
    const { invoke, exists, files, removals } = await fixture();
    await invoke({ platform: "onebot", channel: "group" });
    for (const file of files) expect(await exists(file)).toBe(file !== "onebot/group.agent.jsonl");
    expect(removals.map(({ query }) => query)).toEqual(new Array(4).fill({ platform: "onebot", channelId: "group" }));
});
it("explicit private target cleanup leaves other private conversations intact", async () => {
    const { invoke, exists, files } = await fixture();
    await invoke({ target: "onebot:private:bob" });
    for (const file of files) expect(await exists(file)).toBe(file !== "onebot/private_bob.agent.jsonl");
});
it("typed cleanup tolerates missing platform history", async () => {
    const { manager, exists, files } = await fixture();
    await manager.clearAgentHistory("missing", undefined, "private");
    for (const file of files) expect(await exists(file)).toBe(true);
});

it("channel cleanup reports retained legacy rows instead of claiming the whole file was deleted", async () => {
    const { invoke, logRoot } = await fixture();
    await fs.appendFile(path.join(logRoot, "qq/private_alice.agent.jsonl"), '{"type":"agent_thought"}\n');
    const result = await invoke({ target: "qq:private:alice" });
    expect(result).toContain("有 1 条归属不明的旧记录已保留");
    expect(result).not.toContain("Agent日志文件已删除");
    expect(await fs.readFile(path.join(logRoot, "qq/private_alice.agent.jsonl"), "utf8")).toBe('{"type":"agent_thought"}\n');
});
