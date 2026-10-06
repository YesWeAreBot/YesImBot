import { afterEach, expect, it, spyOn } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { InteractionManager } from "../src/services/worldstate/interaction-manager";
import { Services } from "../src/shared/constants";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "yib-log-clear-"));
    roots.push(root);
    const logger = { info() {}, error() {}, debug() {}, warn() {} };
    const manager = new InteractionManager({ baseDir: root, [Services.Logger]: { getLogger: () => logger } } as any, {} as any);
    const logFile = path.join(root, "data/yesimbot/interactions/qq/private_u.agent.jsonl");
    await fs.mkdir(path.dirname(logFile), { recursive: true });
    const row = (channelId: string, id = channelId) => JSON.stringify({ type: "agent_heartbeat", platform: "qq", channelId, id, timestamp: new Date().toISOString(), current: 1, max: 2 });
    const seed = () => fs.writeFile(logFile, [row("private:u"), row("private_u"), '{"type":"agent_heartbeat","id":"unowned"}', "broken row"].join("\n") + "\n");
    return { root, manager, logFile, row, seed, content: () => fs.readFile(logFile, "utf8") };
}

it("channel cleanup retains another channel sharing the filename and unowned rows", async () => {
    const f = await fixture();
    await f.seed();
    await f.manager.clearAgentHistory("qq", "private:u");
    const content = await f.content();
    expect(content).not.toContain('"channelId":"private:u"');
    expect(content).toContain(f.row("private_u").split(',"timestamp"')[0]);
    expect(content).toContain('"id":"unowned"');
    expect(content).toContain("broken row");
});

for (const type of ["private", "guild"] as const) {
    it(`${type} cleanup uses each row's actual channel type`, async () => {
        const f = await fixture();
        await f.seed();
        await f.manager.clearAgentHistory("qq", undefined, type);
        const content = await f.content();
        expect(content.includes('"channelId":"private:u"')).toBe(type !== "private");
        expect(content.includes('"channelId":"private_u"')).toBe(type !== "guild");
        expect(content).toContain('"id":"unowned"');
    });
}

it("platform cleanup retains another platform sharing a sanitized directory", async () => {
    const f = await fixture();
    const file = path.join(f.root, "data/yesimbot/interactions/a_b/group.agent.jsonl");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, ["a:b", "a_b"].map(platform => JSON.stringify({ platform, channelId: "group" })).join("\n") + "\n");
    await f.manager.clearAgentHistory("a:b");
    expect(await fs.readFile(file, "utf8")).toBe('{"platform":"a_b","channelId":"group"}\n');
});

it("new rows carry their exact origin and wait for an in-flight rewrite", async () => {
    const f = await fixture();
    await f.seed();
    const originalRead = fs.readFile.bind(fs);
    let entered!: () => void;
    const started = new Promise<void>(resolve => entered = resolve);
    let release!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    const read = spyOn(fs, "readFile").mockImplementation(async (...args: any[]) => {
        const content = await originalRead(...args as Parameters<typeof fs.readFile>);
        if (args[0] === f.logFile) { entered(); await gate; }
        return content;
    });
    const mkdir = spyOn(fs, "mkdir").mockResolvedValue(undefined);
    const append = spyOn(fs, "appendFile");
    try {
        const clearing = f.manager.clearAgentHistory("qq", "private:u");
        // Baseline deletes the whole file; avoid waiting for a write that never happens.
        await Promise.race([started, clearing]);
        const recording = f.manager.recordHeartbeat("new", "qq", "private_u", 1, 2);
        await Promise.resolve();
        await Promise.resolve();
        expect(append).not.toHaveBeenCalled();
        release();
        await Promise.all([clearing, recording]);
        const rows = (await f.content()).trim().split("\n").filter(line => line.startsWith("{"));
        const entry = rows.map(line => JSON.parse(line)).find(entry => entry.turnId === "new");
        expect(entry).toMatchObject({ platform: "qq", channelId: "private_u" });
        expect(await f.content()).toContain('"id":"private_u"');
    } finally {
        release();
        read.mockRestore();
        mkdir.mockRestore();
        append.mockRestore();
    }
});

it("full cleanup tolerates an immediately following prune and permits new writes", async () => {
    const f = await fixture();
    await f.seed();
    const clearing = f.manager.clearAgentHistory();
    const pruning = f.manager.pruneOldData();
    await Promise.all([clearing, pruning]);
    await f.manager.recordHeartbeat("after-clear", "qq", "private_u", 1, 2);
    expect(JSON.parse(await f.content())).toMatchObject({ turnId: "after-clear", platform: "qq", channelId: "private_u" });
});
