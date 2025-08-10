import { Context, Logger, Query } from "koishi";

import { Services, TableName } from "@/shared/constants";
import { HistoryConfig } from "./config";
import { WorldStateService } from "./index";
import { MessageData } from "./types";

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
                        const messages = await this.ctx.database.get(TableName.Messages, { channelId }, { fields: ["platform"] });
                        const platforms = [...new Set(messages.map((d) => d.platform))];

                        if (platforms.length === 0) return `🟡🟡🟡 频道 "${channelId}" 未找到任何历史记录，已跳过`;
                        if (platforms.length === 1) platform = platforms[0];
                        else
                            /* prettier-ignore */
                            return `❌❌ 频道 "${channelId}" 存在于多个平台: ${platforms.join(", ")}请使用 -p <platform> 来指定`;
                    }

                    // const messageCount = await this.ctx.database.eval(TableName.Messages, { platform, channelId }, (row) => row.count());
                    const messageCount = await this.ctx.database.get(TableName.Messages, { platform, channelId }, { fields: ["id"] });

                    /* prettier-ignore */
                    return `在 ${platform}:${channelId} 中有 ${messageCount.length} 条消息，L1工作记忆中最多保留 ${this.config.l1_memory.maxMessages} 条`;
                }
            });

        historyCmd
            .subcommand(".clear", "清除指定频道的历史记录", { authority: 3 })
            .option("all", "-a <type:string> 清理全部指定类型的频道 (private, guild, all)")
            .option("platform", "-p <platform:string> 指定平台")
            .option("channel", "-c <channel:string> 指定频道ID (多个用逗号分隔)")
            .option("target", "-t <target:string> 指定目标 'platform:channelId' (多个用逗号分隔)")
            .usage(
                `清除历史记录上下文
从数据库中永久移除相关对话、消息和系统事件，此操作不可恢复

当单独使用 -c 指定的频道ID存在于多个平台时，指令会要求您使用 -p 或 -t 来明确指定平台`
            )
            .example(
                [
                    "",
                    "history.clear                      # 清除当前频道的历史记录",
                    "history.clear -c 12345678          # 清除频道 12345678 的历史记录",
                    "history.clear -a private           # 清除所有私聊频道的历史记录",
                ].join("\n")
            )
            .action(async ({ session, options }) => {
                const results: string[] = [];

                // 优化后的核心操作函数
                const performClear = async (query: Query.Expr<MessageData>, description: string) => {
                    try {
                        const { removed: messagesRemoved } = await this.ctx.database.remove(TableName.Messages, query);
                        const { removed: eventsRemoved } = await this.ctx.database.remove(TableName.SystemEvents, query);
                        const { removed: turnsRemoved } = await this.ctx.database.remove(TableName.AgentTurns, query);
                        results.push(
                            `✅ ${description} - 操作成功，共删除了 ${messagesRemoved} 条消息, ${turnsRemoved} 个Agent回应和 ${eventsRemoved} 个系统事件。`
                        );
                    } catch (error) {
                        this.ctx.logger.warn(`为 ${description} 清理历史记录时失败:`, error);
                        results.push(`❌ ${description} - 操作失败`);
                    }
                };

                if (options.all) {
                    if (options.all === undefined) return "错误：-a 的参数必须是 'private', 'guild', 或 'all'";
                    let query: Query.Expr<MessageData> = {};
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
                            const messages = await this.ctx.database.get(TableName.Messages, { channelId }, { fields: ["platform"] });
                            const platforms = [...new Set(messages.map((d) => d.platform))];
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

                return `--- 清理报告 ---\n${results.join("\n")}`;
            });
    }
}
// #endregion
