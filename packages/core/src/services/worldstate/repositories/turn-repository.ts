import { $, Context, Random } from "koishi";
import { Event, GenericEvent, Member, MemberJoinedEvent, MemberLeftEvent, MessageEvent, Turn } from "../interfaces";
import { EventData, TableName, TurnData } from "../model";
import { MemberRepository } from "./member-repository";

/**
 * 回合仓储 (Turn Repository)
 *
 * 职责:
 * - 管理 Turn 的生命周期（创建、获取）。
 * - 负责将数据库中的 TurnData 和 EventData “水合”成包含完整上下文的 Turn 领域对象。
 */
export class TurnRepository {
    constructor(private ctx: Context, private memberRepo: MemberRepository) {}

    /**
     * 获取或创建一个新的当前回合。
     * 逻辑: 优先返回进行中的回合 -> 新回合 -> 创建一个新回合。
     * @param platform 平台名称
     * @param channelId 频道ID
     * @returns 当前回合的数据库记录 (TurnData)
     */
    public async getOrCreateCurrentTurn(platform: string, channelId: string): Promise<TurnData> {
        const activeTurns = await this.ctx.database
            .select(TableName.Turns)
            .where({ platform, channelId })
            .where((row) => $.or($.eq(row.status, "new"), $.eq(row.status, "in_progress")))
            .orderBy("startTimestamp", "desc")
            .limit(1)
            .execute();

        if (activeTurns.length > 0) {
            // 优先返回 'in_progress' 的
            const inProgress = activeTurns.find((t) => t.status === "in_progress");
            if (inProgress) return inProgress;
            // 否则返回 'new' 的
            return activeTurns[0];
        }

        // 创建新回合
        const newTurn: TurnData = {
            id: `turn_${Date.now()}_${Random.id(8)}`,
            channelId,
            platform,
            status: "new",
            summary: "",
            startTimestamp: new Date(),
            endTimestamp: new Date(), // 初始时与开始相同，在回合完成时更新
        };
        await this.ctx.database.create(TableName.Turns, newTurn);
        return newTurn;
    }

    /**
     * 获取指定频道的完整回合历史。
     * @param platform 平台名称
     * @param channelId 频道ID
     * @param options.limit 获取的回合数量限制
     * @returns 包含完整上下文的 Turn 对象数组
     */
    public async getFullTurns(platform: string, channelId: string, options: { limit: number }): Promise<Turn[]> {
        const [channelRecord] = await this.ctx.database.get("channel", { id: channelId, platform });
        if (!channelRecord || !channelRecord.guildId) return []; // 如果没有 guildId，无法获取成员信息

        const turnRecords = await this.ctx.database.get(
            TableName.Turns,
            { platform, channelId },
            { limit: options.limit, sort: { startTimestamp: "desc" } }
        );

        if (!turnRecords.length) return [];
        return Promise.all(turnRecords.map((turn) => this._hydrateTurn(turn, platform, channelRecord.guildId, channelId)));
    }

    /**
     * 内部辅助方法：将单个 TurnData “水合”成完整的 Turn 领域对象。
     */
    private async _hydrateTurn(turnRecord: TurnData, platform: string, guildId: string, channelId: string): Promise<Turn> {
        // --- 步骤 1: 获取此回合下的所有事件记录 ---
        const eventRecords = await this.ctx.database.get(TableName.Events, { turnId: turnRecord.id });

        // --- 步骤 2: 收集所有事件中涉及到的用户PID ---
        const allPids = new Set<string>();
        for (const event of eventRecords) {
            const payload = event.payload as any; // any is acceptable here for dynamic key access
            if (payload.actorId) allPids.add(payload.actorId);
            if (payload.userId) allPids.add(payload.userId);
            // 未来可扩展更多需要解析的ID字段
        }

        // --- 步骤 3: 批量“水合”所有相关成员 ---
        const memberMap = await this.memberRepo.hydrateMembers(platform, guildId, channelId, Array.from(allPids));
        const unknownUser = (pid: string): Member => ({ id: pid, name: `未知用户(${pid})` });

        // --- 步骤 4: 构建包含完整 Member 对象的事件数组 ---
        const hydratedEvents: Event[] = eventRecords
            .map((record) => this._hydrateSingleEvent(record, memberMap, unknownUser))
            .filter(Boolean) as Event[];

        // --- 步骤 5: 组装最终的 Turn 对象 ---
        return {
            id: turnRecord.id,
            status: turnRecord.status,
            summary: turnRecord.summary,
            events: hydratedEvents,
            responses: [], // AgentResponses 将由另一个服务或方法处理
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
