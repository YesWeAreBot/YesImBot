import { Context, Logger, Query } from "koishi";

import { Services, TableName } from "@/shared/constants";
import { HistoryConfig } from "./config";
import { WorldStateService } from "./index";
import { InteractionData } from "./types";

// =================================================================================
// #region HistoryCommandManager - 负责所有CLI指令
// =================================================================================
export class HistoryCommandManager {
    private logger: Logger;

    constructor(
        private ctx: Context,
        private service: WorldStateService,
        private config: HistoryConfig
    ) {
        this.logger = ctx[Services.Logger].getLogger("[世界状态.指令]");
    }

    public register(): void {
        const historyCmd = this.ctx.command("history", "历史记录管理指令集", { authority: 3 });

        historyCmd
            .subcommand(".count", "统计历史记录中激活的消息数量")
            .option("platform", "-p <platform:string> 指定平台")
            .option("channel", "-c <channel:string> 指定频道ID")
            .option("target", "-t <target:string> 指定目标 'platform:channelId'")
            .action(async ({ session, options }) => {
                let platform = options.platform || session.platform;
                let channelId = options.channel || session.channelId;

                // 从 -t, --target 解析
                if (options.target) {
                    const parts = options.target.split(":");
                    if (parts.length < 2) {
                        return `❌❌ 格式错误的目标: "${options.target}"，已跳过`;
                    }
                    platform = parts[0];
                    channelId = parts.slice(1).join(":");
                }

                if (channelId) {
                    if (!platform) {
                        const interactions = await this.ctx.database.get(TableName.Interactions, { channelId }, { fields: ["platform"] });
                        const platforms = [...new Set(interactions.map((d) => d.platform))];

                        if (platforms.length === 0) return `🟡🟡🟡 频道 "${channelId}" 未找到任何历史记录，已跳过`;
                        if (platforms.length === 1) platform = platforms[0];
                        else
                            /* prettier-ignore */
                            return `❌❌ 频道 "${channelId}" 存在于多个平台: ${platforms.join(", ")}请使用 -p <platform> 来指定`;
                    }

                    const interactions = await this.ctx.database.get(TableName.Interactions, {
                        platform,
                        channelId,
                    });
                    const allMessages = await this.ctx.database.get(TableName.Messages, {
                        interactionId: { $in: interactions.map((i) => i.id) },
                    });

                    /* prettier-ignore */
                    return `在 ${platform}:${channelId} 中有 ${allMessages.length} 条消息${allMessages.length > this.config.l1_memory.maxMessages ? `，L1工作记忆中最多保留 ${this.config.l1_memory.maxMessages} 条` : ""}`;
                }
            });

        historyCmd
            .subcommand(".clear", "清除指定频道的历史记录", { authority: 3 })
            .option("all", "-a <type:string> 清理全部指定类型的频道 (private, guild, all)")
            .option("platform", "-p <platform:string> 指定平台")
            .option("channel", "-c <channel:string> 指定频道ID (多个用逗号分隔)")
            .option("target", "-t <target:string> 指定目标 'platform:channelId' (多个用逗号分隔)")
            .option("delete", "--delete 永久删除记录(包括关联消息)，而非归档", { type: "boolean" })
            .usage(
                `清除历史记录上下文
默认操作是将消息标记为"已归档"，数据仍保留在数据库中
使用 --delete 选项会从数据库中永久移除相关对话、消息和系统事件，此操作不可恢复

当单独使用 -c 指定的频道ID存在于多个平台时，指令会要求您使用 -p 或 -t 来明确指定平台`
            )
            .example(
                [
                    "",
                    "history.clear                      # 清除当前频道的历史记录",
                    "history.clear -c 12345678          # 清除频道 12345678 的历史记录",
                    "history.clear -a private           # 归档所有私聊频道的历史记录",
                    "history.clear -a guild --delete    # 永久删除所有群聊对话及关联消息",
                ].join("\n")
            )
            .action(async ({ session, options }) => {
                const isDelete = !!options.delete;
                const actionPastTense = isDelete ? "永久删除" : "归档";
                const results: string[] = [];

                // 优化后的核心操作函数
                const performClear = async (query: Query<Partial<InteractionData>>, description: string) => {
                    try {
                        const interactions = await this.ctx.database.get(TableName.Interactions, query, { fields: ["id"] });
                        const interactionIds = interactions.map((i) => i.id);

                        if (interactionIds.length === 0) {
                            results.push(`🟡 ${description} - 未找到匹配的历史记录`);
                            return;
                        }

                        if (isDelete) {
                            await this.ctx.database.withTransaction(async (db) => {
                                const { removed: messagesRemoved } = await db.remove(TableName.Messages, {
                                    interactionId: { $in: interactionIds },
                                });
                                const { removed: eventsRemoved } = await db.remove(TableName.SystemEvents, {
                                    interactionId: { $in: interactionIds },
                                });
                                const { removed: turnsRemoved } = await db.remove(TableName.AgentTurns, {
                                    interactionId: { $in: interactionIds },
                                });
                                const { removed: interactionsRemoved } = await db.remove(TableName.Interactions, {
                                    id: { $in: interactionIds },
                                });
                                /* prettier-ignore */
                                results.push(`✅ ${description} - 操作成功，共${actionPastTense}了 ${interactionsRemoved} 个交互轮次及其关联的 ${messagesRemoved} 条消息, ${turnsRemoved} 个Agent回应和 ${eventsRemoved} 个系统事件。`);
                            });
                        } else {
                            // "Archiving" now means ensuring the turn is 'processed' and old.
                            // The system will naturally move it out of L1. A specific 'archived' status is not needed.
                            const { modified } = await this.ctx.database.set(
                                TableName.Interactions,
                                { id: { $in: interactionIds }, status: "pending" },
                                { status: "processed" }
                            );
                            /* prettier-ignore */
                            results.push(`✅ ${description} - ${modified} 个待处理的交互轮次已标记为完成，它们将随后被归档。`);
                        }
                    } catch (error) {
                        this.ctx.logger.warn(`为 ${description} 清理历史记录时失败:`, error);
                        results.push(`❌ ${description} - 操作失败，数据库更改已回滚`);
                    }
                };

                if (options.all) {
                    if (options.all === undefined) return "错误：-a 的参数必须是 'private', 'guild', 或 'all'";
                    let query: Query<InteractionData> = {};
                    let description = "";
                    switch (options.all) {
                        case "private":
                            query = { channelId: { $regex: /^private:/ } };
                            description = "所有私聊频道";
                            break;
                        case "guild":
                            query = { channelId: { $not: { $regex: /^private:/ } } };
                            description = "所有群聊频道";
                            break;
                        case "all":
                            query = {};
                            description = "所有频道";
                            break;
                    }
                    await performClear(query, description);
                    return results.join("\n");
                }

                const targetsToProcess: { platform: string; channelId: string }[] = [];
                const ambiguousChannels: string[] = [];

                if (options.target) {
                    for (const target of options.target
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean)) {
                        const parts = target.split(":");
                        if (parts.length < 2) {
                            results.push(`❌ 格式错误的目标: "${target}"`);
                            continue;
                        }
                        targetsToProcess.push({ platform: parts[0], channelId: parts.slice(1).join(":") });
                    }
                }

                if (options.channel) {
                    for (const channelId of options.channel
                        .split(",")
                        .map((c) => c.trim())
                        .filter(Boolean)) {
                        if (options.platform) {
                            targetsToProcess.push({ platform: options.platform, channelId });
                        } else {
                            const interactions = await this.ctx.database.get(
                                TableName.Interactions,
                                { channelId },
                                { fields: ["platform"] }
                            );
                            const platforms = [...new Set(interactions.map((d) => d.platform))];
                            if (platforms.length === 0) results.push(`🟡 频道 "${channelId}" 未找到`);
                            else if (platforms.length === 1) targetsToProcess.push({ platform: platforms[0], channelId });
                            else ambiguousChannels.push(`频道 "${channelId}" 存在于多个平台: ${platforms.join(", ")}`);
                        }
                    }
                }

                if (ambiguousChannels.length > 0) return `操作已中止:\n${ambiguousChannels.join("\n")}\n请使用 -p 或 -t 指定平台`;

                if (targetsToProcess.length === 0 && !options.target && !options.channel) {
                    if (session.platform && session.channelId)
                        targetsToProcess.push({ platform: session.platform, channelId: session.channelId });
                    else return "无法确定当前会话，请使用选项指定频道";
                }

                if (targetsToProcess.length === 0 && results.length === 0) return "没有指定任何有效的清理目标";

                for (const target of targetsToProcess) {
                    await performClear(
                        { platform: target.platform, channelId: target.channelId },
                        `目标 "${target.platform}:${target.channelId}"`
                    );
                }

                return `--- 清理报告 ---\n操作类型：${actionPastTense}\n${results.join("\n")}`;
            });
    }
}
// #endregion
