/**
 * 定义了 PlatformService 返回的、经过丰富和统一的平台信息结构。
 */

export interface RichUserInfo {
    id: string;
    name?: string;
    avatar?: string;
    // -- 平台特定字段 --
    sex?: "male" | "female" | "unknown";
    sign?: string;
    age?: number;
    // -- 可扩展字段 --
    [key: string]: any;
}

export interface RichGuildInfo {
    id: string;
    name?: string;
    avatar?: string;
    // -- 平台特定字段 --
    memberCount?: number;
    maxMemberCount?: number;
    // -- 可扩展字段 --
    [key: string]: any;
}

export type MemberRole = "member" | "admin" | "owner";

export interface RichMemberInfo {
    // 身份信息
    user: RichUserInfo;
    // 群内信息
    nick?: string;
    role?: MemberRole;
    joinedAt?: Date;
    // -- 平台特定字段--
    level?: string;
    title?: string;
    // -- 可扩展字段 --
    [key: string]: any;
}
