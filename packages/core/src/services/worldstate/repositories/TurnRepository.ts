import { Context } from "koishi";
import {
    Action,
    ActionResult,
    AgentResponse,
    ChannelEvent,
    MessageSentEvent,
    SystemNotificationEvent,
    Turn,
    UserJoinedEvent,
    UserLeftEvent,
} from "../interfaces";
import { AgentResponseData, TurnData } from "../model";
import { MemberRepository } from "./MemberRepository";

export class TurnRepository {
    constructor(private ctx: Context, private memberRepo: MemberRepository) {}

    async getFullTurns(platform: string, channelId: string): Promise<Turn[]> {
        const turnRecords = await this.ctx.database.get("turns", { platform, channelId });
        if (!turnRecords.length) return [];
        return Promise.all(turnRecords.map((turn) => this.buildFullTurn(turn, platform, channelId)));
    }

    private async buildFullTurn(turnRecord: TurnData, platform: string, channelId: string): Promise<Turn> {
        // 1.1 获取此 Turn 下的所有原始事件记录，并按时间戳排序
        // 1.2 获取此 Turn 下的所有 AI 响应
        const [eventRecords, responseRecords] = await Promise.all([
            this.ctx.database.get("channel_events", { turnId: turnRecord.id }, { sort: { timestamp: "asc" } }),
            this.ctx.database.get("agent_responses", { turnId: turnRecord.id }),
        ]);

        // 2. Build the AgentResponse array.
        const responses = this.buildAgentResponses(responseRecords);

        // 3. 一次性获取所有事件中涉及到的成员信息
        const allMemberPids = new Set<string>();
        for (const event of eventRecords) {
            const data = event.data as any; // 临时转为 any 以便访问属性
            if (data.actorId) allMemberPids.add(data.actorId);
            if (data.userId) allMemberPids.add(data.userId);
            if (data.senderId) allMemberPids.add(data.senderId);
        }

        // 使用 MemberRepository 获取完整的 Member 对象，并建立一个 Map 以便快速查找
        const memberMap = new Map(
            (await this.memberRepo.getFullMembersByPids(platform, channelId, Array.from(allMemberPids))).map((m) => [m.id, m])
        );

        // 4. 动态构建事件数组 (Hydration)
        const events: ChannelEvent[] = eventRecords
            .map((record) => {
                const data = record.data as any;
                const base = { id: record.id, timestamp: record.timestamp };
                const systemActor = { id: "system", name: "System", meta: {} }; // 默认系统角色

                switch (record.type) {
                    case "user_joined":
                        return {
                            ...base,
                            type: "user_joined",
                            actor: memberMap.get(data.actorId) ?? systemActor,
                            user: memberMap.get(data.userId) ?? { id: data.userId, name: "未知用户" },
                            note: data.note,
                        } as UserJoinedEvent;
                    case "user_left":
                        return {
                            ...base,
                            type: "user_left",
                            actor: memberMap.get(data.actorId) ?? systemActor,
                            user: memberMap.get(data.userId) ?? { id: data.userId, name: "未知用户" },
                            reason: data.reason,
                        } as UserLeftEvent;
                    case "message_sent":
                        return {
                            ...base,
                            type: "message_sent",
                            messageId: data.messageId,
                            sender: memberMap.get(data.senderId) ?? { id: data.senderId, name: "未知用户" },
                            content: data.content,
                        } as MessageSentEvent;
                    case "system_notification":
                        return { ...base, type: "system_notification", content: data.content } as SystemNotificationEvent;
                    default:
                        return null;
                }
            })
            .filter(Boolean);

        return {
            id: turnRecord.id,
            status: turnRecord.status,
            summary: turnRecord.summary,
            responses,
            events,
        };
    }

    /**
     * 将数据库中的 AgentResponseData 记录转换为业务层的 AgentResponse 对象数组。
     * @param records - 从 agent_responses 表查询出的记录数组
     * @returns - 符合 AgentResponse 接口定义的对象数组
     */
    private buildAgentResponses(records: AgentResponseData[]): AgentResponse[] {
        if (!records || records.length === 0) return [];
        return records.map((record) => ({
            thoughts: this.validateThoughts(record.thoughts),
            actions: this.validateActions(record.actions),
            observations: this.validateObservations(record.observations),
        }));
    }

    // --- Optional validation methods for robustness ---
    private validateThoughts(data: any): AgentResponse["thoughts"] {
        if (typeof data !== "object" || data === null) return { obverse: "", analyze_infer: "", plan: "" };
        return {
            obverse: typeof data.obverse === "string" ? data.obverse : "",
            analyze_infer: typeof data.analyze_infer === "string" ? data.analyze_infer : "",
            plan: typeof data.plan === "string" ? data.plan : "",
        };
    }
    private validateActions(data: any): Action[] {
        if (!Array.isArray(data)) return [];
        return data
            .filter((item) => typeof item === "object" && item !== null && typeof item.function === "string")
            .map((item) => ({
                function: item.function,
                params: typeof item.params === "object" && item.params !== null ? item.params : {},
                renderParams() {
                    return JSON.stringify(this.params);
                },
            }));
    }
    private validateObservations(data: any): ActionResult[] {
        if (!Array.isArray(data)) return [];
        const observations = data.filter((item) => typeof item === "object" && item !== null) as ActionResult[];
        observations.forEach((item) => {
            item.renderResult = function () {
                const result = this.result?.result || this.result?.error || "";
                return typeof result === "string" ? result : JSON.stringify(result);
            };
        });
        return observations;
    }
}
