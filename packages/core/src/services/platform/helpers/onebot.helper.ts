import { Session } from "koishi";
import { } from "koishi-plugin-adapter-onebot";
import type { AccountInfo, StatusInfo, VersionInfo } from "koishi-plugin-adapter-onebot/lib/types";
import { IPlatformHelper } from "../platform.interface";
import { RichGuildInfo, RichMemberInfo, RichUserInfo } from "../types";

export class OneBotPlatformHelper implements IPlatformHelper {
    get platformName(): string {
        return "onebot";
    }

    getRichGuildInfo(session: Session, guildId: string): Promise<RichGuildInfo | null> {
        throw new Error("Method not implemented.");
    }
    getRichUserInfo(session: Session, userId: string): Promise<RichUserInfo | null> {
        throw new Error("Method not implemented.");
    }
    getRichMemberInfo(session: Session, guildId: string, userId: string): Promise<RichMemberInfo | null> {
        throw new Error("Method not implemented.");
    }

    /** 账号相关 */
    getLoginInfo(session: Session): Promise<AccountInfo> {
        return session.onebot.getLoginInfo();
    }

    getStatus(session: Session): Promise<StatusInfo> {
        return session.onebot.getStatus();
    }

    getVersionInfo(session: Session): Promise<VersionInfo> {
        return session.onebot.getVersionInfo();
    }

    setProfile(session: Session, nickname: string, company: string, email: string, college: string, personalNote: string): Promise<void> {
        return session.onebot.setQqProfile(nickname, company, email, college, personalNote);
    }

    setAvatar(session: Session, avatarUrl: string): Promise<void> {
        return session.onebot.setQqAvatar(avatarUrl);
    }

    /** 好友相关 */
    getFriendList(session: Session): Promise<any[]> {
        return session.onebot.getFriendList();
    }

    getFriendInfo(session: Session, userId: string): Promise<any> {
        return session.onebot.getStrangerInfo(parseInt(userId, 10));
    }

    deleteFriend(session: Session, userId: string): Promise<void> {
        return session.onebot.deleteFriend(parseInt(userId, 10));
    }

    /** 群相关 */
    getGroupList(session: Session): Promise<any[]> {
        return session.onebot.getGroupList();
    }

    getGroupInfo(session: Session, groupId: string): Promise<any> {
        return session.onebot.getGroupInfo(parseInt(groupId, 10));
    }

    getGroupMemberList(session: Session, groupId: string): Promise<any[]> {
        return session.onebot.getGroupMemberList(parseInt(groupId, 10));
    }

    /** 消息相关 */

    /** 文件相关 */

    /** AI 相关 */

    /** 转发与分享 */

    /** 其他功能 */
}
