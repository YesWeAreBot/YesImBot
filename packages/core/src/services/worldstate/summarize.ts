// =================================================================================
// #region 自动总结管理
// =================================================================================

import { formatDate } from "@/shared";
import { randomUUID } from "crypto";
import { Logger, h } from "koishi";
import { Context } from "vm";
import { IChatModel, TaskType } from "../model";
import { PromptService } from "../prompt";
import { Services, TableName } from "../types";
import { HistoryConfig } from "./config";
import { DialogueSegmentData, MemberData, MessageData, SystemEventData } from "./database-models";
import { CommandInvocationPayload } from "./event-types";

export class SummarizationManager {
    private logger: Logger;

    private promptService: PromptService;

    private chatModel: IChatModel;

    /**
     * 正在处理总结的频道集合
     */
    private summarizingChannels: Set<string> = new Set();

    constructor(private ctx: Context, private config: HistoryConfig) {
        this.logger = ctx[Services.Logger].getLogger("[自动总结]");
        this.promptService = ctx[Services.Prompt];
        this.chatModel = ctx[Services.Model].useChatGroup(TaskType.Summarization)?.current;

        this.registerTemplates();
    }

    /**
     * 注册总结相关的模板
     */
    private registerTemplates(): void {
        this.promptService.registerTemplate("worldstate.summarization", this.config.summarizationPrompt);

        // 注册总结相关的片段
        this.promptService.registerSnippet("aiIdentity", (context) => context.aiIdentity);

        this.promptService.registerSnippet(
            "previousSummary",
            (context) => context.previousSummary || "无（这是第一次总结)"
        );

        this.promptService.registerSnippet("newMessages", (context) => context.newMessages);
    }

    /**
     * 查找并触发符合总结条件的频道的总结归档流程
     */
    public async targetSummarizationTasks(): Promise<void> {
        const channels = await this.findChannelsForSummarization();
        if (channels.length > 0) {
            this.logger.info(`发现 ${channels.length} 个频道符合自动总结条件`);
            await Promise.all(channels.map((ch) => this.summarizeAndArchive(ch.platform, ch.channelId)));
        }
    }

    /**
     * 查找哪些频道有足够多的 'folded' 片段以触发总结
     */
    private async findChannelsForSummarization(): Promise<{ platform: string; channelId: string }[]> {
        const allFoldedSegments = await this.ctx.database.get(TableName.DialogueSegments, { status: "folded" });

        const channelCounts = new Map<string, number>();
        const channelMetas = new Map<string, { platform: string; channelId: string }>();

        for (const segment of allFoldedSegments) {
            const key = `${segment.platform}:${segment.channelId}`;
            channelCounts.set(key, (channelCounts.get(key) || 0) + 1);
            if (!channelMetas.has(key)) {
                channelMetas.set(key, { platform: segment.platform, channelId: segment.channelId });
            }
        }

        const channelsToProcess: { platform: string; channelId: string }[] = [];
        for (const [key, count] of channelCounts.entries()) {
            if (count >= this.config.summarizationTriggerCount) {
                /* prettier-ignore */
                this.logger.debug(`频道 ${key} 有 ${count} 个 folded 片段，达到总结阈值 ${this.config.summarizationTriggerCount}`);
                channelsToProcess.push(channelMetas.get(key)!);
            }
        }
        return channelsToProcess;
    }

    /**
     * 对指定频道的 'folded' 片段进行总结和归档，采用滚动总结策略
     * @param platform 平台名称
     * @param channelId 频道 ID
     */
    public async summarizeAndArchive(platform: string, channelId: string): Promise<void> {
        if (!this.chatModel) {
            this.logger.error(`未找到可用的聊天模型，无法进行总结 | 频道: ${platform}:${channelId}`);
            return;
        }

        // 检查是否正在处理中
        if (this.summarizingChannels.has(`${platform}:${channelId}`)) {
            this.logger.debug(`频道 ${platform}:${channelId} 正在处理中，跳过`);
            return;
        }

        this.summarizingChannels.add(`${platform}:${channelId}`);

        this.logger.info(`开始处理滚动总结 | 频道: ${platform}:${channelId}`);

        try {
            // 步骤 1: 获取所有待总结的 'folded' 片段
            const foldedSegments = await this.ctx.database
                .get(TableName.DialogueSegments, { platform, channelId, status: "folded" })
                .then((res) => res.sort((a, b) => a.startTimestamp.getTime() - b.startTimestamp.getTime()));

            if (foldedSegments.length < this.config.summarizationTriggerCount) {
                /* prettier-ignore */
                this.logger.debug(`片段数量 (${foldedSegments.length}) 未达阈值 (${this.config.summarizationTriggerCount})，跳过 | 频道: ${channelId}`);

                this.summarizingChannels.delete(`${platform}:${channelId}`);
                return;
            }

            // 步骤 2: 获取上一次的总结
            const previousSummarySegment = await this.ctx.database
                .get(TableName.DialogueSegments, { platform, channelId, status: "summarized" })
                .then((res) => res.sort((a, b) => b.startTimestamp.getTime() - a.startTimestamp.getTime())[0]);

            // 步骤 3: 渲染新的对话内容为文本
            const newMessagesText = await this.renderSegmentsToTextForSummary(foldedSegments);
            if (!newMessagesText) {
                this.logger.warn(`无法为频道 ${channelId} 的新消息生成对话文本，将直接归档，避免阻塞`);
                await this.ctx.database.set(
                    TableName.DialogueSegments,
                    { id: { $in: foldedSegments.map((s) => s.id) } },
                    { status: "archived" }
                );
                this.summarizingChannels.delete(`${platform}:${channelId}`);
                return;
            }

            const bot = this.ctx.bots.find((b) => b.platform === platform);
            if (!bot) {
                this.logger.error(`未找到 ${platform} 平台的机器人实例，无法进行总结 | 频道: ${channelId}`);
                this.summarizingChannels.delete(`${platform}:${channelId}`);
                return;
            }

            // 4. 构建模型所需的 Prompt
            const aiIdentity = `ID: ${bot.selfId}, 昵称: ${bot.user.name || "AI Assistant"}`;

            this.ctx.emit(
                "worldstate:summary",
                { id: bot.selfId, name: bot.user.name || "AI Assistant" },
                foldedSegments
            );

            const renderContext = {
                aiIdentity,
                previousSummary: previousSummarySegment?.summary,
                newMessages: newMessagesText,
            };

            const prompt = await this.promptService.render("worldstate.summarization", renderContext);

            // 5. 调用模型生成新总结
            const summaryResponse = await this.chatModel
                .chat({
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.2,
                })
                .catch((e) => {
                    this.logger.error(e, `模型调用失败 | 频道: ${channelId}`);
                    return null;
                });
            const newSummaryText = summaryResponse?.text;

            if (!newSummaryText) {
                /* prettier-ignore */
                this.logger.warn(`模型未返回有效的总结内容，将直接归档所有 folded 和旧 summarized 片段 | 频道: ${channelId}`);
                // 即使总结失败，也要清理，避免无限重试
                const idsToArchive = foldedSegments.map((s) => s.id);
                if (previousSummarySegment) {
                    idsToArchive.push(previousSummarySegment.id);
                }
                await this.ctx.database.set(
                    TableName.DialogueSegments,
                    { id: { $in: idsToArchive } },
                    { status: "archived" }
                );
                this.summarizingChannels.delete(`${platform}:${channelId}`);
                return;
            }

            // 6. 创建新的总结片段
            const latestTimestamp = foldedSegments[foldedSegments.length - 1].startTimestamp;
            const newSummarySegment: DialogueSegmentData = {
                id: randomUUID(),
                platform: platform,
                channelId: channelId,
                guildId: foldedSegments[0].guildId,
                status: "summarized",
                summary: newSummaryText,
                startTimestamp: previousSummarySegment ? previousSummarySegment.endTimestamp : latestTimestamp,
                endTimestamp: latestTimestamp,
                agentTurn: null,
            };

            // 7. 在一个事务中完成所有数据库操作
            const idsToArchive = foldedSegments.map((s) => s.id);
            if (previousSummarySegment) {
                idsToArchive.push(previousSummarySegment.id);
            }

            await this.ctx.database.withTransaction(async (db) => {
                await db.create(TableName.DialogueSegments, newSummarySegment);
                if (idsToArchive.length > 0) {
                    await db.set(TableName.DialogueSegments, { id: { $in: idsToArchive } }, { status: "archived" });
                }
            });

            this.summarizingChannels.delete(`${platform}:${channelId}`);

            /* prettier-ignore */
            this.logger.info(`[滚动总结] 成功 | 频道: ${channelId} | 新总结ID: ${newSummarySegment.id} | 归档了 ${idsToArchive.length} 个旧片段`);
        } catch (error) {
            this.logger.error(error, `滚动总结失败 | 频道: ${channelId}`);
            this.summarizingChannels.delete(`${platform}:${channelId}`);
        }
    }

    /**
     * 将一组对话片段渲染为纯文本，专用于总结任务
     */
    private async renderSegmentsToTextForSummary(segments: DialogueSegmentData[]): Promise<string> {
        if (!segments || segments.length === 0) return "";

        const segmentIds = segments.map((segment) => segment.id);

        // 1. 一次性获取所有相关消息和系统事件，并按时间排序
        const [allMessages, allSystemEvents] = await Promise.all([
            this.ctx.database.get(TableName.Messages, { sid: { $in: segmentIds } }),
            this.ctx.database.get(TableName.SystemEvents, { sid: { $in: segmentIds } }),
        ]);

        // 将消息和事件合并到一个数组中进行统一排序
        const allItems = [
            ...allMessages.map((item) => ({ ...item, itemType: "message" })),
            ...allSystemEvents.map((item) => ({ ...item, itemType: "event" })),
        ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        if (allItems.length === 0) return "";

        // 2. 收集所有唯一的发送者ID，仅从消息中收集
        const senderIds = [...new Set(allMessages.map((msg) => msg.sender.id))];
        const membersMap = new Map<string, MemberData>();
        if (senderIds.length > 0) {
            const membersData = await this.ctx.database.get(TableName.Members, {
                platform: segments[0].platform,
                pid: { $in: senderIds },
            });
            membersData.forEach((member) => membersMap.set(member.pid, member));
        }

        // 3. 格式化为文本
        const dialogueLines = allItems
            .map((item) => {
                const timestampStr = formatDate(item.timestamp, "HH:mm");

                if (item.itemType === "message") {
                    const msg = item as MessageData;
                    const member = membersMap.get(msg.sender.id);
                    const senderName = member?.name || msg.sender.name || msg.sender.id;
                    const contentText = h
                        .parse(msg.content)
                        .map((el) => el.toString())
                        .join("")
                        .trim();
                    if (!contentText) return null;
                    return `[${timestampStr}] ${senderName}: ${contentText.replace(/\n/g, " ")}`;
                }

                if (item.itemType === "event" && (item as SystemEventData).type === "command-invoked") {
                    const event = item as SystemEventData;
                    const payload = event.payload as CommandInvocationPayload;
                    return `[${timestampStr}] [系统事件] 用户 ${payload.invoker.name} 调用了指令: ${payload.name}`;
                }

                return null; // 忽略其他类型的系统事件
            })
            .filter(Boolean);

        return dialogueLines.join("\n");
    }
}
