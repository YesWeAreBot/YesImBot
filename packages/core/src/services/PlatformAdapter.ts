import { Session, h } from "koishi";
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

    get name() { return this.session.platform }

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

    // 执行指令
    abstract executeCommand(command: string, channelId: string): Promise<void>;

    // 添加表态
    abstract createReaction(messageId: string, emojiId: number): Promise<any>;

    // 设置精华消息
    abstract setEssenceMessage(messageId: string): Promise<any>;

    // 发送戳一戳
    abstract sendPoke(userId: string, channelId: string): Promise<void>;

    // 获取转发消息
    abstract getForwardMessage(id: string): Promise<any>;

    // 撤回消息
    abstract deleteMessage(messageId: string, channelId: string): Promise<void>;

    // 禁言用户
    abstract muteMember(userId: string, channelId: string, durationMinutes: number): Promise<void>;
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

    async executeCommand(command: string, channelId: string): Promise<void> {
        await this.session.execute(command);
    }

    async createReaction(messageId: string, emojiId: number): Promise<any> {
        throw new Error("Not implemented in DefaultPlatform");
    }

    async setEssenceMessage(messageId: string): Promise<any> {
        throw new Error("Not implemented in DefaultPlatform");
    }

    async sendPoke(userId: string, channelId: string): Promise<void> {
        throw new Error("Not implemented in DefaultPlatform");
    }

    async getForwardMessage(id: string): Promise<any> {
        throw new Error("Not implemented in DefaultPlatform");
    }

    async deleteMessage(messageId: string, channelId: string): Promise<void> {
        await this.session.bot.deleteMessage(channelId, messageId);
    }

    async muteMember(userId: string, channelId: string, durationMinutes: number): Promise<void> {
        const durationMs = durationMinutes * 60 * 1000;
        await this.session.bot.muteGuildMember(channelId, userId, durationMs);
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
        const memberInfo = await this.session.onebot.getGroupMemberInfo(groupId, userId, false);
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

    async executeCommand(command: string, channelId: string): Promise<void> {
        if (channelId === this.session.channelId) {
            await this.session.execute(command);
        } else {
            await this.session.bot.sendMessage(channelId, h("execute", {}, command));
        }
    }

    async createReaction(messageId: string, emojiId: number): Promise<any> {
        //@ts-ignore
        return this.session.onebot._request("set_msg_emoji_like", {
            message_id: messageId,
            emoji_id: emojiId,
        });
    }

    async setEssenceMessage(messageId: string): Promise<any> {
        //@ts-ignore
        return this.session.onebot._request("set_essence_msg", { message_id: messageId });
    }

    async sendPoke(userId: string, channelId: string): Promise<void> {
        if (!channelId.startsWith("private:")) {
        	//@ts-ignore
            await this.session.onebot._request("send_poke", {
                channel: channelId,
                group_id: channelId,
                user_id: userId,
            });
        } else {
        	//@ts-ignore
            await this.session.onebot._request("send_poke", {
                user_id: userId,
            });
        }
    }

    async getForwardMessage(id: string): Promise<any> {
    	//@ts-ignore
        return this.session.onebot._request("get_forward_msg", { id });
    }

    async deleteMessage(messageId: string, channelId: string): Promise<void> {
    	//@ts-ignore
        await this.session.bot.deleteMessage(channelId, messageId);
    }

    async muteMember(userId: string, channelId: string, durationMinutes: number): Promise<void> {
        const durationMs = durationMinutes * 60 * 1000;
        //@ts-ignore
        await this.session.bot.muteGuildMember(channelId, userId, durationMs);
    }
}
