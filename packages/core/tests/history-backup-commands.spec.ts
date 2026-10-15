import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, it, onTestFinished, vi } from "vitest";

import { HistoryBackupManager } from "../src/services/worldstate/history-backup";
import { registerHistoryBackup } from "../src/services/worldstate/history-backup-commands";

async function fixture(allowed = true) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "yib-backup-command-"));
    onTestFinished(async () => {
        vi.restoreAllMocks();
        await fs.rm(root, { recursive: true, force: true });
    });
    const actions = new Map<string, Function>();
    const authorities = new Map<string, number>();
    const command: any = {
        subcommand(name: string, _description: string, config: any) {
            authorities.set(name, config.authority);
            const cmd: any = {
                usage: () => cmd,
                action: (action: Function) => {
                    actions.set(name, action);
                    return cmd;
                },
            };
            return cmd;
        },
    };
    const ctx: any = { baseDir: root, scope: { key: "core" }, filter: () => allowed };
    const world: any = { isChannelAllowed: () => allowed };
    registerHistoryBackup(ctx, command, world);
    return { actions, authorities, session: { platform: "qq", selfId: "bot", channelId: "room" }, root };
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

it("denies a filtered-out session before reading or writing a backup file", async () => {
    const f = await fixture(false);
    const result = await f.actions.get(".backup.restore <id:string>")!({ session: f.session }, "../outside");
    expect(String(result)).toContain("未启用");
    expect(await fs.readdir(f.root)).toEqual([]);
});
