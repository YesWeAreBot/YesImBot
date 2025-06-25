import { Context, Random } from "koishi";
import { DialogueSegment, Event, GenericEvent, Member, MemberJoinedEvent, MemberLeftEvent, MessageEvent } from "../interfaces";
import { DialogueSegmentData, EventData, TableName } from "../model";
import { MemberRepository } from "./member";

export class DialogueSegmentRepository {
    constructor(private ctx: Context, private memberRepo: MemberRepository) {}

    public async getOrCreateOpenSegment(platform: string, channelId: string): Promise<DialogueSegmentData> {
        const openSegments = await this.ctx.database
            .select(TableName.DialogueSegments)
            .where({ platform, channelId, status: "open" })
            .orderBy("startTimestamp", "desc")
            .limit(1)
            .execute();

        if (openSegments.length > 0) {
            return openSegments[0];
        }

        const newSegment: DialogueSegmentData = {
            id: `seg_${Date.now()}_${Random.id(8)}`,
            channelId,
            platform,
            status: "open",
            summary: "",
            startTimestamp: new Date(),
            endTimestamp: new Date(), // 初始时与开始相同，在片段关闭时更新
        };
        await this.ctx.database.create(TableName.DialogueSegments, newSegment);
        return newSegment;
    }

    public async hydrateSegment(
        segmentRecord: DialogueSegmentData,
        platform: string,
        guildId: string,
        channelId: string
    ): Promise<DialogueSegment> {
        // --- 步骤 1: 获取此片段下的所有事件记录 ---
        const eventRecords = await this.ctx.database.get(TableName.Events, { segmentId: segmentRecord.id });

        // --- 步骤 2 & 3: 收集PIDs并批量水合 (逻辑与旧版 _hydrateTurn 相同) ---
        const allPids = new Set<string>();
        // ... 收集 pids 的逻辑 ...
        for (const event of eventRecords) {
            const payload = event.payload as any;
            if (payload.actorId) allPids.add(payload.actorId);
            if (payload.userId) allPids.add(payload.userId);
            // 未来可扩展更多需要解析的ID字段
        }
        const memberMap = await this.memberRepo.hydrateMembers(platform, guildId, channelId, Array.from(allPids));
        const unknownUser = (pid: string): Member => ({ id: pid, name: `未知用户(${pid})` });

        // --- 步骤 4: 构建包含完整 Member 对象的事件数组 ---
        const hydratedEvents: Event[] = eventRecords
            .map((record) => this._hydrateSingleEvent(record, memberMap, unknownUser))
            .filter(Boolean) as Event[];

        // --- 步骤 5: 组装最终的 DialogueSegment 对象 ---
        return {
            id: segmentRecord.id,
            platform: segmentRecord.platform, // 添加此行
            channelId: segmentRecord.channelId, // 添加此行
            status: segmentRecord.status,
            summary: segmentRecord.summary,
            events: hydratedEvents,
            is_dialogue_segment: true,
            is_agent_turn: false,
        };
    }

    /**
     * 内部辅助方法：将单个 EventData “水合”成完整的 Event 领域对象。
     */
    private _hydrateSingleEvent(record: EventData, memberMap: Map<string, Member>, unknownUser: (pid: string) => Member): Event | null {
        const payload = record.payload as any;
        const baseEvent = {
            id: record.id,
            type: record.type,
            timestamp: record.timestamp,
            [`is_${record.type}`]: true,
        };

        try {
            switch (record.type) {
                case "message":
                    return {
                        ...baseEvent,
                        payload: {
                            content: payload.content,
                            messageId: payload.messageId,
                            actor: memberMap.get(payload.actorId) ?? unknownUser(payload.actorId),
                        },
                    } as MessageEvent;
                case "member-joined":
                case "member-left":
                    return {
                        ...baseEvent,
                        payload: {
                            actor: memberMap.get(payload.actorId) ?? unknownUser(payload.actorId),
                            user: memberMap.get(payload.userId) ?? unknownUser(payload.userId),
                        },
                    } as MemberJoinedEvent | MemberLeftEvent;
                default:
                    // 对于通用事件，也尝试水合 actor
                    if (payload.actorId) {
                        payload.actor = memberMap.get(payload.actorId) ?? unknownUser(payload.actorId);
                    }
                    return { ...baseEvent, payload } as GenericEvent;
            }
        } catch (error) {
            this.ctx.logger("worldstate").warn(`Failed to hydrate event ${record.id}:`, error);
            return null; // 避免单个事件的水合失败导致整个流程中断
        }
    }
}
