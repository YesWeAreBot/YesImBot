import { Bot, Session, Channel as KChannel } from "koishi";
import { RichGuildInfo, RichUserInfo, RichMemberInfo } from "./types";

/**
 * 平台助手接口 (IPlatformHelper) - 无状态
 */
export interface IPlatformHelper {
    get platformName(): string;

    // --- 信息获取 ---
    getRichGuildInfo(session: Session, guildId: string): Promise<RichGuildInfo | null>;
    getRichUserInfo(session: Session, userId: string): Promise<RichUserInfo | null>;
    getRichMemberInfo(session: Session, guildId: string, userId: string): Promise<RichMemberInfo | null>;
}
