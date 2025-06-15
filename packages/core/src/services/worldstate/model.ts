import { Context } from "koishi";
import { Action, ActionResult, Thought, Turn } from "./interfaces";

// --- Data Transfer Objects (DTOs) / Database Table Schemas ---
// 这些接口精确匹配数据库中的一行数据

export interface MemberData {
    userId: number;
    platform: string;
    channelId: string;
    nick: string;
    role: string;
    lastActive: Date;
}

export interface TurnData {
    id: string;
    channelId: string;
    platform: string;
    status: Turn["status"];
    summary: string;
    startTimestamp: Date;
    endTimestamp: Date;
}

export interface AgentResponseData {
    id: number;
    turnId: string;
    thoughts: Thought;
    actions: Action[];
    observations: ActionResult[];
}

export interface ChannelEventData {
    id: number; // 自增主键，用于唯一标识和排序
    turnId: string; // 外键，关联到 Turn
    type: string; // 事件类型，如 'user_joined', 'message_sent'
    timestamp: Date; // 事件发生时间
    data: object; // JSON 字段，存储该事件类型的特定数据
}

// --- Koishi-specific Table Augmentation ---
// 扩展 Koishi 的核心接口和表定义

declare module "koishi" {
    interface User {
        avatar?: string;
        createdAt: Date;
        updatedAt: Date;
    }

    interface Channel {
        name?: string;
        type?: "guild" | "private" | "sandbox";
        description?: string;
        totalMemberCount?: number;
        recentActiveCount?: number;
        lastActivityAt?: Date;
    }

    interface Tables {
        members: MemberData;
        turns: TurnData;
        channel_events: ChannelEventData;
        agent_responses: AgentResponseData;
    }
}

export const name = "yesimbot-models";
export const inject = ["database"];

export function apply(ctx: Context) {
    ctx.model.extend("user", {
        avatar: "string",
        createdAt: "timestamp",
        updatedAt: "timestamp",
    });

    ctx.model.extend("channel", {
        name: "string",
        type: "string",
        description: "text",
        totalMemberCount: "unsigned",
        recentActiveCount: "unsigned",
        lastActivityAt: "timestamp",
    });

    ctx.model.extend(
        "members",
        {
            userId: "unsigned",
            platform: "string(255)",
            channelId: "string(255)",
            nick: "string",
            role: "string",
            lastActive: "timestamp",
        },
        {
            primary: ["userId", "platform", "channelId"],
            foreign: {
                userId: ["user", "id"],
                channelId: ["channel", "id"],
                platform: ["channel", "platform"],
            },
        }
    );

    ctx.model.extend(
        "channel_events",
        {
            id: "unsigned",
            turnId: "string(64)",
            type: "string(64)",
            timestamp: "timestamp",
            data: "json",
        },
        {
            autoInc: true,
            primary: "id",
            foreign: {
                turnId: ["turns", "id"],
            },
        }
    );

    ctx.model.extend(
        "turns",
        {
            id: "char(64)",
            channelId: "char(64)",
            platform: "char(64)",
            status: "string",
            summary: "text",
            startTimestamp: "timestamp",
            endTimestamp: "timestamp",
        },
        {
            primary: "id",
            foreign: {
                channelId: ["channel", "id"],
                platform: ["channel", "platform"],
            },
        }
    );

    ctx.model.extend(
        "agent_responses",
        {
            id: "unsigned",
            turnId: "char(64)",
            thoughts: "json",
            actions: "json",
            observations: "json",
        },
        {
            autoInc: true,
            primary: "id",
            foreign: {
                turnId: ["turns", "id"],
            },
        }
    );
}
