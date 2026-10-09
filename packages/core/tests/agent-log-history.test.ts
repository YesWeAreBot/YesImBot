import { afterEach, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { InteractionManager } from "../src/services/worldstate/interaction-manager";
import { Services } from "../src/shared/constants";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "yib-log-history-"));
    roots.push(root);
    const logger = { info() {}, error() {}, debug() {}, warn() {} };
    const manager = new InteractionManager(
        {
            baseDir: root,
            [Services.Logger]: { getLogger: () => logger },
            database: { get: async () => [] },
        } as any,
        {} as any,
    );
    const seed = async (relativePath: string, rows: Array<string | Record<string, unknown>>) => {
        const file = path.join(root, "data/yesimbot/interactions", relativePath);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row))).join("\n") + "\n");
    };
    const turns = async (platform: string, channelId: string, limit = 10) =>
        (await manager.getL1History(platform, channelId, limit)).map((item) => (item as any).turnId);
    return { manager, seed, turns };
}

const heartbeat = (turnId: string, origin: Record<string, unknown> = {}) => ({
    type: "agent_heartbeat",
    id: turnId,
    turnId,
    timestamp: "2026-10-01T12:00:00.000Z",
    current: 1,
    max: 2,
    ...origin,
});

it("L1 reads exact channel metadata when private and guild IDs share a filename", async () => {
    const f = await fixture();
    await f.manager.recordHeartbeat("private", "qq", "private:u", 1, 2);
    await f.manager.recordHeartbeat("guild", "qq", "private_u", 1, 2);
    expect(await f.turns("qq", "private:u")).toEqual(["private"]);
    expect(await f.turns("qq", "private_u")).toEqual(["guild"]);
});

it("L1 reads exact platform metadata when platforms share a directory", async () => {
    const f = await fixture();
    await f.manager.recordHeartbeat("colon", "a:b", "group", 1, 2);
    await f.manager.recordHeartbeat("underscore", "a_b", "group", 1, 2);
    expect(await f.turns("a:b", "group")).toEqual(["colon"]);
    expect(await f.turns("a_b", "group")).toEqual(["underscore"]);
});

it("L1 filters ownership before taking the latest agent event limit", async () => {
    const f = await fixture();
    await f.seed("qq/private_u.agent.jsonl", [
        heartbeat("older", { platform: "qq", channelId: "private:u" }),
        heartbeat("newer", { platform: "qq", channelId: "private:u" }),
        heartbeat("other-1", { platform: "qq", channelId: "private_u" }),
        heartbeat("other-2", { platform: "qq", channelId: "private_u" }),
    ]);
    expect(await f.turns("qq", "private:u", 2)).toEqual(["older", "newer"]);
});

for (const scenario of [
    { name: "unique legacy file", platform: "qq", channelId: "group", file: "qq/group.agent.jsonl", origin: {}, want: ["legacy"] },
    {
        name: "unique legacy row with matching platform",
        platform: "qq",
        channelId: "group",
        file: "qq/group.agent.jsonl",
        origin: { platform: "qq" },
        want: ["legacy"],
    },
    {
        name: "unique legacy row with matching channel",
        platform: "qq",
        channelId: "group",
        file: "qq/group.agent.jsonl",
        origin: { channelId: "group" },
        want: ["legacy"],
    },
    { name: "legacy row with mismatched platform", platform: "qq", channelId: "group", file: "qq/group.agent.jsonl", origin: { platform: "other" }, want: [] },
    { name: "legacy row with mismatched channel", platform: "qq", channelId: "group", file: "qq/group.agent.jsonl", origin: { channelId: "other" }, want: [] },
    { name: "ambiguous legacy private channel", platform: "qq", channelId: "private:u", file: "qq/private_u.agent.jsonl", origin: {}, want: [] },
    { name: "ambiguous legacy guild channel", platform: "qq", channelId: "private_u", file: "qq/private_u.agent.jsonl", origin: { platform: "qq" }, want: [] },
    { name: "ambiguous legacy platform", platform: "a:b", channelId: "group", file: "a_b/group.agent.jsonl", origin: { channelId: "group" }, want: [] },
] as const) {
    it(`L1 ownership handles ${scenario.name} consistently with scoped cleanup`, async () => {
        const f = await fixture();
        await f.seed(scenario.file, [heartbeat("legacy", scenario.origin)]);
        expect(await f.turns(scenario.platform, scenario.channelId)).toEqual([...scenario.want]);
        const preserved = await f.manager.clearAgentHistory(scenario.platform, scenario.channelId);
        expect(preserved).toBe(scenario.name.startsWith("ambiguous") ? 1 : 0);
        expect(await f.turns(scenario.platform, scenario.channelId)).toEqual([]);
    });
}

it("scoped clear prevents the cleared channel from reading a surviving colliding channel", async () => {
    const f = await fixture();
    await f.manager.recordHeartbeat("private", "qq", "private:u", 1, 2);
    await f.manager.recordHeartbeat("guild", "qq", "private_u", 1, 2);
    await f.manager.clearAgentHistory("qq", "private:u");
    expect(await f.turns("qq", "private:u")).toEqual([]);
    expect(await f.turns("qq", "private_u")).toEqual(["guild"]);
});

it("L1 retains valid rows around malformed and unsupported log entries", async () => {
    const f = await fixture();
    await f.seed("qq/group.agent.jsonl", [
        heartbeat("before", { platform: "qq", channelId: "group" }),
        "broken row",
        "null",
        { type: "unsupported" },
        heartbeat("bad-date", { platform: "qq", channelId: "group", timestamp: "invalid" }),
        heartbeat("after", { platform: "qq", channelId: "group" }),
    ]);
    expect(await f.turns("qq", "group")).toEqual(["before", "after"]);
});

it("normal thought, action, observation and heartbeat records continue entering L1", async () => {
    const f = await fixture();
    await f.manager.recordThought("turn", "qq", "group", { observe: "seen", analyze_infer: "inferred", plan: "planned" });
    const actionId = await f.manager.recordAction("turn", "qq", "group", { function: "example", params: { value: 1 } });
    await f.manager.recordObservation(actionId, "qq", "group", { turnId: "turn", function: "example", status: "success", result: "done" });
    await f.manager.recordHeartbeat("turn", "qq", "group", 1, 2);
    expect((await f.manager.getL1History("qq", "group", 10)).map((item) => item.type)).toEqual([
        "agent_thought",
        "agent_action",
        "agent_observation",
        "agent_heartbeat",
    ]);
});
