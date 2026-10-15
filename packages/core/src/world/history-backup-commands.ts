import { h, type Command, type Context, type Session } from "koishi";

import { sessionChannelType } from "./channel-metadata";
import { HistoryBackupManager, type BackupTarget } from "./history-backup";
import type { WorldStateService } from "./service";

const limitation =
    "备份包含当前平台与频道的消息、系统事件、L2记忆和L3日记，这四类历史由共库实例共享；备份标记用于核对导出实例。Agent日志仅导出和预检，不恢复；不含配置、人物资料、决策日志、用量统计或持久提醒。";
const count = (value: object) =>
    Object.entries(value)
        .map(([kind, total]) => `${kind}=${total}`)
        .join("，");
function receipt(report: any) {
    const status =
        report.status === "conflict"
            ? "冲突，未写入"
            : report.status === "partial"
              ? "恢复中断，已有或可能已有部分效果，请预检后重试"
              : report.status === "restored"
                ? "四表增量恢复完成"
                : "预检通过";
    const conflicts = report.conflicts
        .slice(0, 10)
        .map((entry: any) => `${entry.kind}:${entry.id}`)
        .join("，");
    return `${status}\n缺失：${count(report.missing)}\n相同：${count(report.identical)}${report.inserted ? `\n本次已确认写入：${count(report.inserted)}` : ""}\n冲突 ${report.conflicts.length} 条${conflicts ? `：${conflicts}` : ""}\nAgent日志 ${report.agentLogs.exported} 条，仅导出和预检，不恢复。${report.metadata?.reason ? `\n${report.metadata.reason}` : ""}`;
}

export function registerHistoryBackup(ctx: Context, command: Command, world: WorldStateService) {
    const targetFor = (session?: Session): BackupTarget => {
        if (!session || !ctx.filter(session) || !world.isChannelAllowed(session)) throw new Error("当前会话未启用历史备份");
        const { platform, channelId, selfId } = session;
        if (!platform || !channelId || !selfId) throw new Error("当前会话缺少平台、频道或机器人标识");
        const channelType = sessionChannelType(session);
        return { platform, channelId, selfId, ...(channelType ? { channelType } : {}) };
    };
    command
        .subcommand(".backup", "备份当前频道的核心历史", { authority: 3 })
        .usage(limitation)
        .action(async ({ session }) => {
            try {
                const target = targetFor(session);
                const saved = await new HistoryBackupManager(ctx, world).save(target);
                return h.text(
                    `已保存备份 ${saved.id}\n文件：${saved.filePath}\n四表：${JSON.stringify(saved.counts)}；Agent日志 ${saved.agentLogs} 条。\n${limitation}`,
                );
            } catch (error) {
                return h.text(`备份失败：${String(error)}`);
            }
        });
    for (const restore of [false, true])
        command
            .subcommand(restore ? ".backup.restore <id:string>" : ".backup.check <id:string>", restore ? "增量补回当前频道的缺失历史" : "预检当前频道备份", {
                authority: 3,
            })
            .usage(`${limitation} 恢复只补缺失行；相同ID内容不同则整批拒绝。写入失败不保证回滚，回执会报告部分效果。`)
            .action(async ({ session }, id) => {
                try {
                    const target = targetFor(session);
                    const manager = new HistoryBackupManager(ctx, world),
                        input = await manager.load(id);
                    const report = restore ? await manager.restore(target, input) : await manager.preflight(target, input);
                    return h.text(receipt(report));
                } catch (error) {
                    return h.text(`${restore ? "恢复" : "预检"}失败：${String(error)}`);
                }
            });
}
