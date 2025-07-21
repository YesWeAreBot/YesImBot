// =================================================================================
// #region 辅助类：UserRecallManager (用户画像智能召回)
// =================================================================================

import { Context, Logger } from "koishi";
import { MemoryService } from "../memory";
import { Services, TableName } from "../types";
import { CacheKeyPrefix, CacheManager } from "./cache-manager";
import { HistoryConfig } from "./config";
import { ContextualMessage } from "./interfaces";
import { extractMentionedUsers } from "./utils";

export class UserRecallManager {
    private memoryService: MemoryService;

    constructor(
        private ctx: Context,
        private config: HistoryConfig,
        private logger: Logger,
        private cacheManager: CacheManager
    ) {
        this.memoryService = ctx[Services.Memory];
    }

    public async recallForPrivateContext(messages: ContextualMessage[], currentUserId: string): Promise<string[]> {
        if (!messages || messages.length === 0) return [];

        const messageHash = this._generateMessageHash(messages) + ":private:" + currentUserId;
        const cachedResult = this.cacheManager.get<string[]>(CacheKeyPrefix.RECALL_RESULTS, messageHash);
        if (cachedResult) {
            this.logger.debug(`使用缓存的私聊召回结果，消息数: ${messages.length}, 用户: ${currentUserId}`);
            return cachedResult;
        }

        const maxRelevantUsers = this.config.recallUserProfileCount;
        const minRelevanceScore = 0.15;
        const userRelevanceMap = new Map<string, number>();

        userRelevanceMap.set(currentUserId, 1.0); // 1. 当前用户

        const directParticipantUserIds = new Set(messages.map((m) => m.sender.id));
        directParticipantUserIds.forEach((id) => {
            // 2. 直接参与者
            if (id !== currentUserId) userRelevanceMap.set(id, Math.max(userRelevanceMap.get(id) || 0, 0.95));
        });

        const semanticUsers = await this.findSemanticRelevantUsers(messages, maxRelevantUsers * 2);
        semanticUsers.forEach(({ userId, score }) => {
            // 3. 语义相关
            if (score >= minRelevanceScore)
                userRelevanceMap.set(userId, Math.max(userRelevanceMap.get(userId) || 0, score * 0.95));
        });

        const namedUsers = await this.findNamedUsers(messages);
        namedUsers.forEach(({ userId, score }) => {
            // 4. 姓名提及
            if (score >= minRelevanceScore)
                userRelevanceMap.set(userId, Math.max(userRelevanceMap.get(userId) || 0, score * 0.8));
        });

        const mentionedUserIds = new Set(messages.flatMap((m) => extractMentionedUsers(m.content)));
        mentionedUserIds.forEach((id) => {
            // 5. @提及
            userRelevanceMap.set(id, Math.max(userRelevanceMap.get(id) || 0, 0.85));
        });

        const sortedUserIds = Array.from(userRelevanceMap.entries())
            .filter(([, score]) => score >= minRelevanceScore)
            .sort(([, a], [, b]) => b - a)
            .slice(0, maxRelevantUsers)
            .map(([userId]) => userId);

        this.logger.debug(
            `私聊智能筛选用户: 当前用户 ${currentUserId}，直接参与者 ${directParticipantUserIds.size} 个，最终选择 ${sortedUserIds.length} 个相关用户`
        );
        this.cacheManager.set(CacheKeyPrefix.RECALL_RESULTS, messageHash, sortedUserIds);
        return sortedUserIds;
    }

    public async recallForGuildContext(messages: ContextualMessage[]): Promise<string[]> {
        if (!messages || messages.length === 0) return [];

        const messageHash = this._generateMessageHash(messages);
        const cachedResult = this.cacheManager.get<string[]>(CacheKeyPrefix.RECALL_RESULTS, messageHash);
        if (cachedResult) {
            this.logger.debug(`使用缓存的召回结果，消息数: ${messages.length}`);
            return cachedResult;
        }

        const maxRelevantUsers = 8;
        const minRelevanceScore = 0.3;
        const relevanceMap = new Map<string, number>();

        // 1. 直接参与者、@提及、引用
        const directParticipantUserIds = new Set<string>();
        const mentionedUserIds = new Set<string>();
        const quotedUserIds = new Set<string>();

        messages.forEach((m) => {
            directParticipantUserIds.add(m.sender.id);
            extractMentionedUsers(m.content).forEach((id) => mentionedUserIds.add(id));
            if (m.quoteId) {
                const quotedMessage = messages.find((msg) => msg.id === m.quoteId);
                if (quotedMessage) quotedUserIds.add(quotedMessage.sender.id);
            }
        });

        directParticipantUserIds.forEach((id) => relevanceMap.set(id, 1.0));
        mentionedUserIds.forEach((id) => relevanceMap.set(id, Math.max(relevanceMap.get(id) || 0, 0.9)));
        quotedUserIds.forEach((id) => relevanceMap.set(id, Math.max(relevanceMap.get(id) || 0, 0.8)));

        // 2. 语义与姓名相关
        const [semanticUsers, namedUsers] = await Promise.all([
            this.findSemanticRelevantUsers(messages, maxRelevantUsers),
            this.findNamedUsers(messages),
        ]);

        semanticUsers.forEach(({ userId, score }) => {
            if (score >= minRelevanceScore)
                relevanceMap.set(userId, Math.max(relevanceMap.get(userId) || 0, score * 0.7));
        });
        namedUsers.forEach(({ userId, score }) => {
            if (score >= minRelevanceScore)
                relevanceMap.set(userId, Math.max(relevanceMap.get(userId) || 0, score * 0.5));
        });

        const sortedUserIds = Array.from(relevanceMap.entries())
            .filter(([, score]) => score >= minRelevanceScore)
            .sort(([, a], [, b]) => b - a)
            .slice(0, maxRelevantUsers)
            .map(([userId]) => userId);

        this.logger.debug(
            `智能筛选用户: 直接参与者 ${directParticipantUserIds.size} 个，最终选择 ${sortedUserIds.length} 个相关用户`
        );
        this.cacheManager.set(CacheKeyPrefix.RECALL_RESULTS, messageHash, sortedUserIds);
        return sortedUserIds;
    }

    private _generateMessageHash(messages: ContextualMessage[]): string {
        const hashInput = messages.map((m) => `${m.id}:${m.timestamp.getTime()}:${m.sender.id}`).join("|");
        let hash = 0;
        for (let i = 0; i < hashInput.length; i++) {
            const char = hashInput.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    private async findSemanticRelevantUsers(
        messages: ContextualMessage[],
        maxUsers: number
    ): Promise<Array<{ userId: string; score: number }>> {
        try {
            const batchText = messages.map((m) => `${m.sender.name}: ${m.content}`).join("\n");
            const [factResults, profileResults] = await Promise.all([
                this.memoryService.searchUserFacts(batchText, { limit: 15 }),
                this.memoryService.searchUserProfiles(batchText, { limit: 10 }),
            ]);

            const userScores = new Map<string, number>();
            factResults.data?.forEach((fact: any) => {
                const score = (fact.salience || 0.5) * 0.8;
                userScores.set(fact.userId, Math.max(userScores.get(fact.userId) || 0, score));
            });
            profileResults.data?.forEach((profile: any) => {
                const score = profile.salience || 0.5;
                userScores.set(profile.userId, Math.max(userScores.get(profile.userId) || 0, score));
            });

            return Array.from(userScores.entries())
                .map(([userId, score]) => ({ userId, score }))
                .sort((a, b) => b.score - a.score)
                .slice(0, maxUsers);
        } catch (error) {
            this.logger.warn(`语义用户查找失败: ${error.message}`);
            return [];
        }
    }

    private async findNamedUsers(messages: ContextualMessage[]): Promise<Array<{ userId: string; score: number }>> {
        try {
            const messageText = messages.map((m) => m.content).join(" ");
            const users = await this.ctx.database.get(TableName.UserProfiles, { isDeleted: false });
            const namedUsers: Array<{ userId: string; score: number }> = [];

            users.forEach((profile) => {
                if (profile.userName && profile.userName.length > 1) {
                    const matches = messageText.match(new RegExp(`\\b${profile.userName}\\b`, "gi"));
                    if (matches?.length > 0) {
                        namedUsers.push({ userId: profile.userId, score: Math.min(matches.length * 0.2 + 0.3, 0.8) });
                    }
                }
            });
            return namedUsers.sort((a, b) => b.score - a.score);
        } catch (error) {
            this.logger.warn(`基于姓名的用户查找失败: ${error.message}`);
            return [];
        }
    }
}
