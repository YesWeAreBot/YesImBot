import { Session } from "koishi";
// import { } from "koishi-plugin-adapter-onebot";

/**
 * 群成员信息
 */
export interface GroypMemberInfo {
    /**
     * 年龄
     */
    age?: number;
    /**
     * 地区
     */
    area?: string;
    /**
     * 群昵称
     */
    card?: string;
    /**
     * 群昵称是否可修改
     */
    card_changeable?: boolean;
    group_id: number;
    /**
     * 是否机器人
     */
    is_robot: boolean;
    /**
     * 加群时间
     */
    join_time?: number;
    /**
     * 最后发言时间
     */
    last_sent_time?: number;
    /**
     * 群等级
     */
    level?: number;
    nickname: string;
    /**
     * Q龄
     */
    qage?: string;
    /**
     * 账号等级
     */
    qq_level?: number;
    /**
     * 权限
     */
    role: string;
    /**
     * 性别
     */
    sex?: string;
    /**
     * 禁言时间戳
     */
    shut_up_timestamp?: number;
    /**
     * 头衔
     */
    title?: string;
    /**
     * 头衔过期时间
     */
    title_expire_time?: number;
    unfriendly?: boolean;
    user_id: number;
    [property: string]: any;
}

export interface UserInfo {
    userId: string;
    sex?: string;
    nickname?: string;
    avatar?: string;
    sign?: string;

    [key: string]: any;
}

export interface GroupInfo {
    groupId: string;
    name?: string;
    avatar?: string;
    maxMemberCount?: number;
    memberCount?: number;

    [key: string]: any;
}

/**
 * 平台信息适配器接口。
 * 封装了获取用户和群信息的平台特定逻辑。
 * @param session 当前会话，可用于获取上下文信息
 */
export abstract class PlatformAdapter {

    constructor(protected session: Session) { }
    /**
     * 获取群信息。
     * @param groupId 群ID
     */
    abstract getGroupInfo(groupId: string): Promise<GroupInfo>;

    /**
     * 获取用户信息。
     * @param userId 用户ID
     */
    abstract getUserInfo(userId: string): Promise<UserInfo>;
}

export class DefaultPlatform extends PlatformAdapter {
    constructor(session: Session) {
        super(session);
    }

    async getGroupInfo(groupId: string): Promise<GroupInfo> {
        const groupInfo = await this.session.bot.getGuild(groupId);
        return {
            groupId: groupInfo.id,
            name: groupInfo.name,
            avatar: groupInfo.avatar,
        }
    }

    async getUserInfo(userId: string): Promise<UserInfo> {
        const userInfo = await this.session.bot.getUser(userId);
        return {
            userId: userInfo.id,
            nickname: userInfo.nick,
            avatar: userInfo.avatar,
        }
    }
}

export class OneBotPlatform extends PlatformAdapter {
    constructor(session: Session) {
        super(session);
    }

    async getGroupInfo(groupId: string): Promise<GroupInfo> {
        //@ts-ignore
        const groupInfo = await this.session.onebot.getGroupInfo(groupId);
        //@ts-ignore
        //const groupNotice = await this.session.onebot.getGroupNotice(groupId);
        //@ts-ignore
        //const groupMemberList = await this.session.onebot.getGroupMemberList(groupId);

        return {
            groupId: String(groupInfo.group_id),
            name: groupInfo.group_name,
            maxMemberCount: groupInfo.max_member_count,
            memberCount: groupInfo.member_count,
        }
    }

    async getUserInfo(userId: string): Promise<UserInfo> {
        //@ts-ignore
        const userInfo = await this.session.onebot.getStrangerInfo(userId);

        return {
            userId: String(userInfo.user_id),
            sex: userInfo.sex,
            nickname: userInfo.nickname,
            age: userInfo.age,
        }
    }
}
