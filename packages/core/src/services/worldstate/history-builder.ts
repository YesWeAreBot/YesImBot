// =================================================================================
// #region 辅助类：HistoryBuilder (构建历史记录)
// =================================================================================

import { ChannelDescriptor } from "@/agent";
import { formatDate } from "@/shared";
import { Context } from "koishi";
import { TableName } from "../types";
import { HistoryConfig } from "./config";
import { DialogueSegmentData, MessageData, SystemEventData } from "./database-models";
import {
    ClosedDialogueSegment,
    ContextualMessage,
    FoldedDialogueSegment,
    History,
    PendingDialogueSegment,
    SummarizedDialogueSegment,
} from "./interfaces";

export class HistoryBuilder {
    constructor(private ctx: Context, private config: HistoryConfig) {}

    /**
     * 从数据库获取并构建完整的对话历史记录
     */
    public async build(channel: ChannelDescriptor): Promise<History> {
        const { platform, id: channelId } = channel;

        // 1. 获取各状态的对话片段
        const [openSegments, rawClosedSegments, rawFoldedSegments, summarizedSegments] = await Promise.all([
            this.ctx.database.get(TableName.DialogueSegments, { platform, channelId, status: "open" }),
            this.ctx.database.get(TableName.DialogueSegments, { platform, channelId, status: "closed" }),
            this.ctx.database.get(TableName.DialogueSegments, { platform, channelId, status: "folded" }),
            this.ctx.database.get(TableName.DialogueSegments, { platform, channelId, status: "summarized" }),
        ]);

        const pendingSegment = openSegments[0];
        const closedSegments = rawClosedSegments
            .sort((a, b) => b.startTimestamp.getTime() - a.startTimestamp.getTime())
            .slice(0, this.config.fullContextSegmentCount)
            .reverse();
        const foldedSegments = rawFoldedSegments
            .sort((a, b) => b.startTimestamp.getTime() - a.startTimestamp.getTime())
            .slice(0, this.config.summarizationTriggerCount)
            .reverse();
        const summarizedSegment = summarizedSegments.sort(
            (a, b) => b.startTimestamp.getTime() - a.startTimestamp.getTime()
        )[0];

        // 2. 批量获取所有需要内容的消息和事件
        const segmentsNeedingContent = [
            ...(pendingSegment ? [pendingSegment] : []),
            ...closedSegments,
            ...foldedSegments,
        ];
        const segmentIds = segmentsNeedingContent.map((s) => s.id);

        const [allMessages, allSystemEvents] =
            segmentIds.length > 0
                ? await Promise.all([
                      this.ctx.database.get(TableName.Messages, { sid: { $in: segmentIds } }),
                      this.ctx.database.get(TableName.SystemEvents, { sid: { $in: segmentIds } }),
                  ])
                : [[], []];

        const messagesBySegment = this.groupDataBySegmentId(allMessages);
        const eventsBySegment = this.groupDataBySegmentId(allSystemEvents);

        // 3. 并行构建对话片段对象
        const [pending, closed, folded, summarized] = await Promise.all([
            pendingSegment ? this.buildPendingSegment(pendingSegment, messagesBySegment, eventsBySegment) : undefined,
            Promise.all(closedSegments.map((r) => this.buildClosedSegment(r, messagesBySegment))),
            foldedSegments.length > 0
                ? this.buildFoldedSegment(foldedSegments, messagesBySegment, eventsBySegment)
                : undefined,
            summarizedSegment ? this.buildSummarizedSegment(summarizedSegment) : undefined,
        ]);

        return { pending, closed, folded, summarized };
    }

    private groupDataBySegmentId<T extends { sid: string }>(data: T[]): Map<string, T[]> {
        const map = new Map<string, T[]>();
        data.forEach((item) => {
            if (!map.has(item.sid)) {
                map.set(item.sid, []);
            }
            map.get(item.sid)!.push(item);
        });
        return map;
    }

    private buildPendingSegment(
        segmentRecord: DialogueSegmentData,
        messagesBySegment: Map<string, MessageData[]>,
        eventsBySegment: Map<string, SystemEventData[]>
    ): PendingDialogueSegment {
        const messageRecords = messagesBySegment.get(segmentRecord.id) || [];
        const systemEventRecords = eventsBySegment.get(segmentRecord.id) || [];

        return {
            type: "dialogue-segment",
            id: segmentRecord.id,
            platform: segmentRecord.platform,
            channelId: segmentRecord.channelId,
            guildId: segmentRecord.guildId,
            status: "open",
            startTimestamp: segmentRecord.startTimestamp,
            dialogue: this.buildDialogueMessages(messageRecords),
            systemEvents: systemEventRecords.map((record) => ({
                id: record.id,
                type: record.type,
                timestamp: record.timestamp,
                date: formatDate(record.timestamp, "MM-DD"),
                payload: record.payload,
            })),
        };
    }

    private buildClosedSegment(
        record: DialogueSegmentData,
        messagesBySegment: Map<string, MessageData[]>
    ): ClosedDialogueSegment {
        const messageRecords = messagesBySegment.get(record.id) || [];
        return {
            type: "dialogue-segment",
            id: record.id,
            platform: record.platform,
            channelId: record.channelId,
            guildId: record.guildId,
            status: "closed",
            startTimestamp: record.startTimestamp,
            endTimestamp: record.endTimestamp,
            agentTurn: record.agentTurn,
            dialogue: this.buildDialogueMessages(messageRecords),
            systemEvents: [],
        };
    }

    private buildFoldedSegment(
        foldedSegments: DialogueSegmentData[],
        messagesBySegment: Map<string, MessageData[]>,
        eventsBySegment: Map<string, SystemEventData[]>
    ): FoldedDialogueSegment {
        const allMessages = foldedSegments.flatMap((s) => messagesBySegment.get(s.id) || []);
        const allSystemEvents = foldedSegments.flatMap((s) => eventsBySegment.get(s.id) || []);

        allMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        allSystemEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        return {
            type: "dialogue-segment",
            id: foldedSegments[0].id,
            platform: foldedSegments[0].platform,
            channelId: foldedSegments[0].channelId,
            guildId: foldedSegments[0].guildId,
            status: "folded",
            dialogue: this.buildDialogueMessages(allMessages),
            systemEvents: allSystemEvents.map((record) => ({
                id: record.id,
                type: record.type,
                timestamp: record.timestamp,
                date: formatDate(record.timestamp, "MM-DD"),
                payload: record.payload,
            })),
            startTimestamp: foldedSegments[0].startTimestamp,
            endTimestamp: foldedSegments[foldedSegments.length - 1].endTimestamp,
        };
    }

    private buildSummarizedSegment(record: DialogueSegmentData): SummarizedDialogueSegment {
        return {
            type: "dialogue-segment",
            id: record.id,
            platform: record.platform,
            channelId: record.channelId,
            guildId: record.guildId,
            status: "summarized",
            summary: record.summary,
            startTimestamp: record.startTimestamp,
            endTimestamp: record.endTimestamp,
        };
    }

    private buildDialogueMessages(messageRecords: MessageData[]): ContextualMessage[] {
        const quotedMsgIds = new Set(messageRecords.filter((m) => m.quoteId).map((m) => m.quoteId));
        return messageRecords.map((record) => ({
            id: record.id,
            content: record.content,
            timestamp: record.timestamp,
            date: formatDate(record.timestamp, "MM-DD"),
            time: formatDate(record.timestamp, "HH:mm"),
            quoted: quotedMsgIds.has(record.id),
            quoteId: record.quoteId,
            sender: { id: record.sender.id, name: record.sender.name, roles: record.sender.roles },
        }));
    }
}
