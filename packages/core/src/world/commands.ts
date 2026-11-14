import { randomUUID } from "node:crypto";

import { Context, h, Logger, Query, Session } from "koishi";

import type { LoggerService } from "../logger";
import { TableName } from "../shared/constants";
import { conversationChannelId } from "../shared/utils/conversation-scope";
import { HISTORY_CHANNELS } from "./channel-metadata";
import { HistoryConfig } from "./config";
import { registerHistoryBackup } from "./history-backup-commands";
import { registerHistoryInspection, type HistoryInspectionDependencies } from "./history-inspection";
import { prepareHistoryReset } from "./history-reset";
import { WorldStateService } from "./index";
import { MessageData } from "./types";

/** Split target lists without splitting the JSON tuple in canonical topic IDs. */
function splitHistoryTargets(value: string): string[] {
    const result: string[] = [];
    let start = 0,
        depth = 0,
        quoted = false,
        escaped = false;
    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        if (quoted) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') quoted = false;
        } else if (char === '"' && depth > 0) quoted = true;
        else if (char === "[") depth++;
        else if (char === "]") depth = Math.max(0, depth - 1);
        else if (char === "," && depth === 0) {
            result.push(value.slice(start, index).trim());
            start = index + 1;
        }
    }
    result.push(value.slice(start).trim());
    return result.filter(Boolean);
}

function validateHistoryTargetOptions(options: { platform?: string; channel?: string; target?: string }): string | undefined {
    if (options.target !== undefined && (options.platform !== undefined || options.channel !== undefined)) return "-t 不能与 -p 或 -c 同时使用。";
    if (options.platform !== undefined && options.channel === undefined) return "-p 需要与 -c 一起使用。";
    if ([options.target, options.channel, options.platform].some((value) => value !== undefined && !value.trim())) return "目标参数不能为空。";
}

function parseHistoryTarget(value: string): { platform: string; channelId: string } | undefined {
    const separator = value.indexOf(":");
    if (separator < 1) return;
    const platform = value.slice(0, separator).trim();
    const channelId = value.slice(separator + 1).trim();
    if (platform && channelId) return { platform, channelId };
}

/** 把召回结果按 3000 字一段发到当前会话。 */
async function displayRecallResult(session: Session, result: unknown) {
    const text = Array.from(JSON.stringify(result, null, 2));
    for (let i = 0; i < text.length; i += 3000) await session.send(h.text(text.slice(i, i + 3000).join("")));
}

// =================================================================================
// #region HistoryCommandManager - 负责所有CLI指令
// =================================================================================
export class HistoryCommandManager {
    private logger: Logger;

    constructor(
        private ctx: Context,
        private service: WorldStateService,
        private config: HistoryConfig,
        logging: LoggerService,
        private inspection?: HistoryInspectionDependencies,
    ) {
        this.logger = logging.getLogger("[世界状态.指令]");
    }

    private async typedChannelQuery(channelType: "private" | "guild"): Promise<Query.Expr<MessageData>> {
        const targets = await this.ctx.database.get(HISTORY_CHANNELS, { channelType });
        return targets.length ? { $or: targets.map(({ platform, channelId }) => ({ platform, channelId })) } : { platform: { $in: [] } };
    }

    public register(): void {
        const historyCmd = this.ctx.command("history", "管理聊天历史、记忆召回、上下文、用量与备份", { authority: 3 });
        historyCmd.usage(
            "权限：管理员（等级至少为 3）。count/recall/diary 默认作用于当前会话；context/tokens 默认查询整个实例。clear 可扩大删除范围，backup 仅覆盖核心历史，具体范围请查看对应子指令的 -h。",
        );
        historyCmd.example("history.context -h").example("history.recall -k messages --display 旅行");
        registerHistoryInspection(this.ctx, historyCmd, this.inspection);
        registerHistoryBackup(this.ctx, historyCmd, this.service);

        historyCmd
            .subcommand(".recall [query:text]", "召回完整原文并注入当前上下文", { authority: 3 })
            .option("kind", "-k <kind:string> messages、l2 或 l3（默认 l3）")
            .option("start", "--start <start:string> 开始日期或时间")
            .option("end", "--end <end:string> 结束日期或时间")
            .option("user", "-u <user:string> 原始消息发送者 ID")
            .option("offset", "-o <offset:natural> 分页位置")
            .option("limit", "-n <limit:natural> 返回条数，最多 20")
            .option("display", "--display 同时向聊天窗口显示原文")
            .usage(
                "范围：当前允许的会话。-k messages 查聊天原文，l2 查记忆片段，l3 查日记（默认）；-u 填原消息发送者账号 ID。结果默认静默注入，--display 才显示到聊天窗口，不强制机器人立即回复。选项必须放在查询词之前；分页从 -o 0 开始。",
            )
            .example("history.recall -k messages --display 旅行")
            .example("history.recall -k messages -u 123456 --start 2026-10-01 --end 2026-10-02")
            .action(async ({ session, options }, query) => {
                if (!session || !options) return;
                try {
                    const result = await this.service.recallContext(session, {
                        query,
                        kind: options.kind as any,
                        start: options.start,
                        end: options.end,
                        userId: options.user,
                        offset: options.offset,
                        limit: options.limit,
                    });
                    await this.service.injectRecall(session, result);
                    if (options.display) await displayRecallResult(session, result);
                    return "";
                } catch (error) {
                    return h.text(`召回失败：${String(error)}`);
                }
            });
        historyCmd
            .subcommand(".diary [date:string]", "手动生成 L3 日记并注入当前上下文", { authority: 3 })
            .option("display", "--display 同时向聊天窗口显示完整结果")
            .usage(
                "范围：当前会话。需要启用 L3 并有足够的新消息材料；省略日期时生成今天的日记。结果默认静默注入，--display 才显示到聊天窗口。日期使用服务器本地时区。",
            )
            .example("history.diary")
            .example("history.diary 2026-10-14 --display")
            .action(async ({ session, options }, date) => {
                if (!session || !options) return;
                try {
                    const result = await this.service.triggerDiary(session, date);
                    await this.service.injectRecall(session, result, "l3_diary_generate");
                    if (options.display) await displayRecallResult(session, result);
                    return "";
                } catch (error) {
                    return h.text(`L3 触发失败：${String(error)}`);
                }
            });

        historyCmd
            .subcommand(".count", "统计所选频道保存的消息数量")
            .option("platform", "-p <platform:string> 指定平台")
            .option("channel", "-c <channel:string> 指定频道ID")
            .option("target", "-t <target:string> 指定目标 'platform:channelId'")
            .usage("默认统计当前会话保存的消息数量。指定其他会话时使用 -t 平台:频道ID，也可以使用 -p 平台与 -c 频道ID。")
            .example("history.count -t onebot:857518324")
            .action(async ({ session, options }) => {
                if (!session || !options) return;
                const invalid = validateHistoryTargetOptions(options);
                if (invalid) return invalid;
                const target = options.target !== undefined ? parseHistoryTarget(options.target) : undefined;
                if (options.target !== undefined && !target) return "目标格式应为 平台:频道ID。";
                const platform = target?.platform ?? options.platform ?? session.platform;
                const channelId = target?.channelId ?? options.channel ?? conversationChannelId(session);
                if (!platform || !channelId) return "无法确定当前会话，请使用 -t 指定目标。";

                const messages = await this.ctx.database.get(TableName.Messages, { platform, channelId }, { fields: ["id"] });
                return `在 ${platform}:${channelId} 中有 ${messages.length} 条消息，L1工作记忆中最多保留 ${this.config.l1_memory.maxMessages} 条`;
            });

        historyCmd
            .subcommand(".clear", "清除指定频道的历史记录", { authority: 3 })
            .option("all", "-a <type:string> 清理全部指定类型的频道（private、guild、all），不能与 -p、-c、-t 混用")
            .option("platform", "-p <platform:string> 指定平台")
            .option("channel", "-c <channel:string> 指定频道ID (多个用逗号分隔)")
            .option("target", "-t <target:string> 指定目标 'platform:channelId' (多个用逗号分隔)")
            .usage(
                `清除历史记录上下文
删除所选范围内的消息、系统事件、L2记忆、L3日记和匹配的Agent日志；未备份的内容无法恢复。
同一数据库中的消息、系统事件、L2记忆和L3日记按平台与频道共享，清除会影响共用这些历史的实例。
全量清理同时重置回复意愿、取消旧回复与总结，并清除已接入的人物记忆；持久提醒和模型用量统计不在清理范围内。归属不明的旧Agent日志可能保留。

指定其他会话时优先使用 -t 平台:频道ID。-t 可以接受逗号分隔的多个目标，不能和 -p 或 -c 同时使用。
使用 -c 且频道 ID 存在于多个平台时，请加上 -p 或改用 -t。`,
            )
            .example(
                [
                    "",
                    "history.clear                      # 清除当前频道的历史记录",
                    "history.clear -c 12345678          # 清除频道 12345678 的历史记录",
                    "history.clear -a private           # 清除所有私聊频道的历史记录",
                ].join("\n"),
            )
            .action(async ({ session, options }) => {
                if (!session || !options) return;
                const results: string[] = [];

                const recordClear = async (target: object, status: string, receipt: object) => {
                    try {
                        await this.service.recordSystemEvent({
                            id: randomUUID(),
                            platform: session!.platform,
                            channelId: conversationChannelId(session!)!,
                            eventScope: options!.all ? "global" : "channel",
                            type: "history-cleared",
                            timestamp: new Date(),
                            payload: {
                                actor: `admin:${session!.platform}:${session!.userId}`,
                                operation: "history.clear",
                                status,
                                scope: options!.all ? "global" : "channel",
                                origin: {
                                    platform: session!.platform,
                                    selfId: session!.selfId,
                                    channelId: conversationChannelId(session!)!,
                                    adapter: session!.bot?.platform,
                                },
                                target,
                                receipt,
                                time: new Date().toISOString(),
                            },
                            message:
                                status === "success"
                                    ? "框架历史清理回执；所选历史与已接入的相关记忆任务已重置。"
                                    : "框架历史清理失败；可能已有部分清理生效，请查看回执。",
                        });
                    } catch (error) {
                        this.logger.warn(`历史清理事件投递失败：${String(error)}`);
                    }
                };

                // 优化后的核心操作函数
                const performClear = async (
                    query: Query.Expr<MessageData>,
                    description: string,
                    target?: { platform: string; channelId: string },
                    channelType?: "private" | "guild" | "all",
                ) => {
                    const scope = target || { type: options.all as "private" | "guild" | "all" };
                    const reset = prepareHistoryReset(this.ctx, scope);
                    try {
                        const { messagesRemoved, eventsRemoved, l2ChunksRemoved, diariesRemoved, agentLogRemoved, agentLogPreserved } =
                            await this.service.l2_manager
                                .clearHistory(scope, async () => {
                                    await reset.ready;
                                    if (channelType && channelType !== "all") query = await this.typedChannelQuery(channelType);
                                    const { removed: messagesRemoved } = await this.ctx.database.remove(TableName.Messages, query);
                                    const { removed: eventsRemoved } = await this.ctx.database.remove(TableName.SystemEvents, query);
                                    const { removed: l2ChunksRemoved } = await this.ctx.database.remove(TableName.L2Chunks, query);
                                    const { removed: diariesRemoved } = await this.ctx.database.remove(TableName.L3Diaries, query);
                                    let agentLogRemoved = false;
                                    let agentLogPreserved = 0;
                                    if (target || options!.all) {
                                        try {
                                            const preserved = await this.service.l1_manager.clearAgentHistory(target?.platform, target?.channelId, channelType);
                                            agentLogPreserved = typeof preserved === "number" ? preserved : 0;
                                            agentLogRemoved = true;
                                        } catch (error) {
                                            // 日记的新任务仍需等本次日志清理结束，再读取原始交互。
                                            if (error.code !== "ENOENT") throw error;
                                        }
                                    }
                                    return {
                                        messagesRemoved,
                                        eventsRemoved,
                                        l2ChunksRemoved,
                                        diariesRemoved,
                                        agentLogRemoved,
                                        agentLogPreserved,
                                    };
                                })
                                .finally(() => reset.finish());

                        await recordClear(target || { historyType: options!.all }, "success", {
                            messagesRemoved,
                            eventsRemoved,
                            l2ChunksRemoved,
                            diariesRemoved,
                            agentLogRemoved,
                            agentLogPreserved,
                        });
                        results.push(
                            `✅ ${description} - 操作成功，共删除了 ${messagesRemoved} 条消息, ${eventsRemoved} 个系统事件, ${l2ChunksRemoved} 个L2记忆片段, ${diariesRemoved} 篇L3日记。${
                                agentLogRemoved
                                    ? `匹配的Agent日志已清理。${agentLogPreserved ? `有 ${agentLogPreserved} 条归属不明的旧记录已保留，请查看日志。` : ""}`
                                    : ""
                            }`,
                        );
                    } catch (error) {
                        this.ctx.logger.warn(`为 ${description} 清理历史记录时失败:`, error);
                        await recordClear(target || { historyType: options!.all }, "failed", {
                            error: String(error).slice(0, 300),
                            partialEffects: "可能已有部分数据删除，未声称回滚",
                        });
                        results.push(`❌ ${description} - 操作失败`);
                    } finally {
                        results.push(...reset.reports());
                    }
                };

                if (options.all !== undefined) {
                    if (options.platform !== undefined || options.channel !== undefined || options.target !== undefined)
                        return "错误：批量清理 -a 不能与 -p、-c 或 -t 同时使用。请单独指定清理范围。";
                    if (options.all !== "private" && options.all !== "guild" && options.all !== "all")
                        return "错误：-a 的参数必须是 'private', 'guild', 或 'all'";
                    let query: Query.Expr<MessageData> = {};
                    let description = "";
                    switch (options.all) {
                        case "private":
                            query = {};
                            description = "所有私聊频道";
                            break;
                        case "guild":
                            query = {};
                            description = "所有群聊频道";
                            break;
                        case "all":
                            query = {};
                            description = "所有频道";
                            break;
                        default:
                            break;
                    }
                    await performClear(query, description, undefined, options.all);
                    return results.join("\n");
                }

                const invalid = validateHistoryTargetOptions(options);
                if (invalid) return invalid;
                const targetsToProcess = new Map<string, { platform: string; channelId: string }>();
                const addTarget = (platform: string, channelId: string) => targetsToProcess.set(JSON.stringify([platform, channelId]), { platform, channelId });
                const ambiguousChannels: string[] = [];

                if (options.target !== undefined) {
                    for (const value of splitHistoryTargets(options.target)) {
                        const target = parseHistoryTarget(value);
                        if (!target) return `目标格式应为 平台:频道ID。无法解析 "${value}"，未执行清理。`;
                        addTarget(target.platform, target.channelId);
                    }
                }

                if (options.channel) {
                    for (const channelId of splitHistoryTargets(options.channel)
                        .map((c) => c.trim())
                        .filter(Boolean)) {
                        if (options.platform) {
                            addTarget(options.platform, channelId);
                        } else {
                            const messages = await this.ctx.database.get(TableName.Messages, { channelId }, { fields: ["platform"] });
                            const platforms = [...new Set(messages.map((d) => d.platform))];
                            if (platforms.length === 0) results.push(`🟡 频道 "${channelId}" 未找到`);
                            else if (platforms.length === 1) addTarget(platforms[0], channelId);
                            else ambiguousChannels.push(`频道 "${channelId}" 存在于多个平台: ${platforms.join(", ")}`);
                        }
                    }
                }

                if (ambiguousChannels.length > 0) return `操作已中止:\n${ambiguousChannels.join("\n")}\n请使用 -p 或 -t 指定平台`;

                if (targetsToProcess.size === 0 && !options.target && !options.channel) {
                    if (session.platform && session.channelId) addTarget(session.platform, conversationChannelId(session)!);
                    else return "无法确定当前会话，请使用选项指定频道";
                }

                if (targetsToProcess.size === 0 && results.length === 0) return "没有指定任何有效的清理目标";

                for (const target of targetsToProcess.values()) {
                    await performClear({ platform: target.platform, channelId: target.channelId }, `目标 "${target.platform}:${target.channelId}"`, target);
                }

                return `--- 清理报告 ---\n${results.join("\n")}`;
            });
    }
}
// #endregion
