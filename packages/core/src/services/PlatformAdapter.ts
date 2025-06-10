import { Session } from "koishi";
// import { } from "koishi-plugin-adapter-onebot";

export type GroupRole = 'member' | 'admin' | 'owner';

export interface GroupMemberInfo {
    area?: string;
    level?: string;
    title?: string;
    role?: GroupRole;
    card?: string;
    card_changeable?: boolean;
    group_id: string;
    join_time: number;
    last_sent_time?: number;
    title_expire_time?: number;
    unfriendly?: boolean;
    [key: string]: any;
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
    
    abstract getGroupMemberInfo(userId: string, groupId: string): Promise<GroupMemberInfo>;
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
    
    async getGroupMemberInfo(userId: string, groupId: string): Promise<GroupMemberInfo> {
        //@ts-ignore
        const memberInfo = await this.session.bot.getGuildMember(groupId, userId);

        return {
            group_id: groupId,
            //is_robot: memberInfo.is_robot,
            join_time: memberInfo.joinedAt,
            user_id: userId
        }
    }
}

export class OneBotPlatform extends PlatformAdapter {
    constructor(session: Session) {
        super(session);
    }

    async getGroupInfo(groupId: string): Promise<GroupInfo> {
        //@ts-ignore
        const groupInfo = await this.session.onebot.getGroupInfo(parseInt(groupId));
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
        const userInfo = await this.session.onebot.getStrangerInfo(parseInt(userId, 10));

        return {
            userId: String(userInfo.user_id),
            sex: userInfo.sex,
            nickname: userInfo.nickname,
            age: userInfo.age,
        }
    }
    
    async getGroupMemberInfo(userId: string, groupId: string): Promise<GroupMemberInfo> {
        //@ts-ignore
        const memberInfo = await this.session.onebot.getGroupMemberInfo(groupId,userId, 10);
        /*const memberInfo = await this.session.onebot.getGroupMemberInfo(
            parseInt(groupId, 10),
            parseInt(userId, 10)
        );
        */

        return {
            //age: memberInfo.age,
            area: memberInfo.area,
            card: memberInfo.card,
            card_changeable: memberInfo.card_changeable,
            group_id: String(memberInfo.group_id),
            //is_robot: memberInfo.is_robot,
            join_time: memberInfo.join_time,
            last_sent_time: memberInfo.last_sent_time,
            level: memberInfo.level,
            //nickname: memberInfo.nickname,
            //qage: memberInfo.qage,
            //qq_level: memberInfo.qq_level,
            role: memberInfo.role,
            sex: memberInfo.sex,
            //shut_up_timestamp: memberInfo.shut_up_timestamp,
            title: memberInfo.title,
            title_expire_time: memberInfo.title_expire_time,
            unfriendly: memberInfo.unfriendly,
            user_id: String(memberInfo.user_id)
        };
    }
}
