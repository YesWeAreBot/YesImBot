import { Session } from 'koishi';
import { IPlatformHelper } from '../platform.interface';
import { RichGuildInfo, RichMemberInfo, RichUserInfo } from '../types';

export class DefaultPlatformHelper implements IPlatformHelper {
    // 这个助手可以被多个平台复用
    constructor(private platform: string) {}

    getRichGuildInfo(session: Session, guildId: string): Promise<RichGuildInfo | null> {
        session.bot.getGuildRoleIter
        throw new Error('Method not implemented.');
    }
    getRichUserInfo(session: Session, userId: string): Promise<RichUserInfo | null> {
        throw new Error('Method not implemented.');
    }
    getRichMemberInfo(session: Session, guildId: string, userId: string): Promise<RichMemberInfo | null> {
        throw new Error('Method not implemented.');
    }
    getForwardMessage?(session: Session, messageId: string): Promise<any> {
        throw new Error('Method not implemented.');
    }
    executeCommand(session: Session, command: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    createReaction(session: Session, messageId: string, emoji: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    setEssenceMessage(session: Session, messageId: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    sendPoke(session: Session, userId: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    deleteMessage(session: Session, messageId: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    muteMember(session: Session, guildId: string, userId: string, duration: number): Promise<void> {
        throw new Error('Method not implemented.');
    }

    get platformName(): string { return this.platform; }



}