import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import memory from "@koishijs/plugin-database-memory";
import pluginMock from "@koishijs/plugin-mock";
import { Context } from "koishi";
import { expect, it, onTestFinished, vi } from "vitest";

import { HistoryBackupManager } from "../src/world/history-backup";
import { registerHistoryBackup } from "../src/world/history-backup-commands";

async function fixture(allowed = true, channelAllowed = allowed) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "yib-backup-command-"));
    onTestFinished(async () => {
        vi.restoreAllMocks();
        await fs.rm(root, { recursive: true, force: true });
    });
    const actions = new Map<string, Function>();
    const authorities = new Map<string, number>();
    const usages = new Map<string, string>();
    const command: any = {
        subcommand(name: string, _description: string, config: any) {
            authorities.set(name, config.authority);
            const cmd: any = {
                usage: (usage: string) => {
                    usages.set(name, usage);
                    return cmd;
                },
                action: (action: Function) => {
                    actions.set(name, action);
                    return cmd;
                },
            };
            return cmd;
        },
    };
    const ctx: any = { baseDir: root, scope: { key: "core" }, filter: () => allowed };
    const world: any = { isChannelAllowed: () => channelAllowed };
    registerHistoryBackup(ctx, command, world);
    return { actions, authorities, usages, session: { platform: "qq", selfId: "bot", channelId: "room" }, root };
}

it("registers administrator-only backup commands and sends a receipt rather than history bodies", async () => {
    const f = await fixture();
    const save = vi
        .spyOn(HistoryBackupManager.prototype, "save")
        .mockResolvedValue({ id: "backup-id", filePath: "/safe/backup.json", counts: { messages: 2, events: 0, l2: 0, l3: 0 }, agentLogs: 1 });
    const result = await f.actions.get(".backup")!({ session: f.session });
    expect([...f.authorities.values()]).toEqual([3, 3, 3]);
    expect(save).toHaveBeenCalledWith(f.session);
    expect(String(result)).toContain("backup-id");
    expect(String(result)).toContain("Agent日志仅导出");
});

it.each([
    [false, true, undefined],
    [false, true, "../outside"],
    [true, false, undefined],
    [true, false, "../outside"],
] as const)("denies an excluded session before accessing backups (filter: %s, channel: %s, ID: %s)", async (allowed, channelAllowed, id) => {
    const f = await fixture(allowed, channelAllowed);
    const result = await f.actions.get(".backup.restore [id:string]")!({ session: f.session }, id);
    expect(String(result)).toContain("未启用");
    expect(await fs.readdir(f.root)).toEqual([]);
});

it("documents optional restore IDs and both default and explicit invocations in help", async () => {
    const f = await fixture();
    const usage = f.usages.get(".backup.restore [id:string]");
    expect(usage).toContain("ID 可选");
    expect(usage).toContain("默认恢复当前频道最新备份");
    expect(usage).toContain("history.backup.restore");
    expect(usage).toContain("history.backup.restore <备份ID>");
    expect(f.actions.has(".backup.check <id:string>")).toBe(true);
});

it("gives a friendly response when the current channel has no backup", async () => {
    const f = await fixture();
    const result = await f.actions.get(".backup.restore [id:string]")!({ session: f.session });
    expect(String(result)).toContain("当前频道暂无备份");
    expect(String(result)).toContain("history.backup");
});

it("parses restore without an ID through real Koishi and preserves the authority gate", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "yib-backup-parser-"));
    const app = new Context({ baseDir: root });
    app.plugin(memory);
    const mockFork = app.plugin((pluginMock as any).default ?? pluginMock);
    const world: any = { isChannelAllowed: () => true };
    registerHistoryBackup(app, app.command("history", "历史管理", { authority: 3 }), world);
    onTestFinished(async () => {
        mockFork.dispose();
        await app.stop();
        await fs.rm(root, { recursive: true, force: true });
    });
    await app.start();
    await app.database.prepared();
    await app.mock.initUser("admin", 3);
    await app.mock.initUser("member", 1);
    await app.mock.initChannel("room");
    const admin = app.mock.client("admin", "room");
    const restore = app.$commander.get("history.backup.restore")!;
    expect(restore._arguments[0].required).toBe(false);
    expect(String(restore._usage)).toContain("ID 可选");
    expect(String(restore._usage)).toContain("默认恢复当前频道最新备份");
    expect(String(restore._usage)).toContain("history.backup.restore <备份ID>");
    expect((await admin.receive("history.backup.restore")).join("")).toContain("当前频道暂无备份");
    expect((await admin.receive("history.backup.restore invalid-id")).join("")).toContain("备份编号无效");
    expect((await app.mock.client("member", "room").receive("history.backup.restore")).join("")).not.toContain("当前频道暂无备份");
});
