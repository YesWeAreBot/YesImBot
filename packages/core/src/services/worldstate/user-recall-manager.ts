// =================================================================================
// #region 辅助类：UserRecallManager (用户画像智能召回)
// =================================================================================

import { Fact, MemoryService, UserProfile } from "@/services/memory";
import { Services, TableName } from "@/shared/constants";
import { Context, h, Logger } from "koishi";
import { HistoryConfig } from "./config";
import { ContextualMessage } from "./types";
import { extractMentionedUsers } from "./utils";

// 定义一个更丰富的用户相关性数据结构
interface IUserRelevance {
    score: number;
    reasons: string[]; // 用于调试，记录得分原因
}

// 权重配置，方便调整和维护
const RECALL_WEIGHTS = {
    DIRECT_PARTICIPANT: 1.0, // 直接参与者
    MENTIONED: 0.8, // 被@
    QUOTED: 0.6, // 被引用
    SEMANTIC_MATCH_MULTIPLIER: 0.7, // 语义相关性得分乘数
    NAMED_MATCH_MULTIPLIER: 0.5, // 名字匹配得分乘数
    PROFILE_EXISTS_BOOST: 1.5, // 用户画像存在性加成系数
};

export class UserRecallManager {
    private memoryService: MemoryService;

    constructor(private ctx: Context, private config: HistoryConfig, private logger: Logger) {
        this.memoryService = ctx[Services.Memory];
    }

    public async recallForPrivateContext(messages: ContextualMessage[], currentUserId: string): Promise<string[]> {
        if (!messages || messages.length === 0) return [];

        const messageHash = this._generateMessageHash(messages) + ":private:" + currentUserId;

        const maxRelevantUsers = this.config.recall.private;
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

        /* prettier-ignore */
        this.logger.debug(`私聊智能筛选用户: 当前用户 ${currentUserId}，直接参与者 ${directParticipantUserIds.size} 个，最终选择 ${sortedUserIds.length} 个相关用户`);
        return sortedUserIds;
    }

    public async recallForGuildContext(messages: ContextualMessage[]): Promise<string[]> {
        if (!messages || messages.length === 0) return [];

        const messageHash = this._generateMessageHash(messages);

        const maxRelevantUsers = this.config.recall.guild;
        const minRelevanceScore = 0.3;

        // 使用新的数据结构，支持分数累加和原因追踪
        const relevanceMap = new Map<string, IUserRelevance>();

        // 帮助函数，用于累加分数并记录原因
        const addUserScore = (userId: string, score: number, reason: string) => {
            if (!relevanceMap.has(userId)) {
                relevanceMap.set(userId, { score: 0, reasons: [] });
            }
            const relevance = relevanceMap.get(userId)!;
            relevance.score += score;
            relevance.reasons.push(`${reason}(+${score.toFixed(2)})`);
        };

        // 1. 直接参与者、@提及、引用 (分数累加)
        messages.forEach((m) => {
            addUserScore(m.sender.id, RECALL_WEIGHTS.DIRECT_PARTICIPANT, "参与对话");

            extractMentionedUsers(m.content).forEach((id) => {
                addUserScore(id, RECALL_WEIGHTS.MENTIONED, "@提及");
            });

            if (m.quoteId) {
                const quotedMessage = messages.find((msg) => msg.id === m.quoteId);
                if (quotedMessage) {
                    addUserScore(quotedMessage.sender.id, RECALL_WEIGHTS.QUOTED, "引用回复");
                }
            }
        });

        // 2. 语义与姓名相关
        const [semanticUsers, namedUsers] = await Promise.all([
            this.findSemanticRelevantUsers(messages, maxRelevantUsers),
            this.findNamedUsers(messages),
        ]);

        semanticUsers.forEach(({ userId, score }) => {
            if (score >= minRelevanceScore) {
                addUserScore(userId, score * RECALL_WEIGHTS.SEMANTIC_MATCH_MULTIPLIER, "语义相关");
            }
        });

        namedUsers.forEach(({ userId, score }) => {
            if (score >= minRelevanceScore) {
                addUserScore(userId, score * RECALL_WEIGHTS.NAMED_MATCH_MULTIPLIER, "名称提及");
            }
        });

        // --- 核心优化点：用户画像可用性验证与加成 ---
        const allCandidateIds = Array.from(relevanceMap.keys());
        if (allCandidateIds.length > 0) {
            const usersWithProfiles = await this.getActiveUserIdsWithProfiles(allCandidateIds);

            usersWithProfiles.forEach((userId) => {
                if (relevanceMap.has(userId)) {
                    const relevance = relevanceMap.get(userId)!;
                    const boost = relevance.score * (RECALL_WEIGHTS.PROFILE_EXISTS_BOOST - 1);
                    relevance.score += boost; // 乘以系数等价于 score = score * BOOST
                    relevance.reasons.push(`画像存在加成(+${boost.toFixed(2)})`);
                }
            });
        }

        // 3. 排序和筛选
        const sortedUserEntries = Array.from(relevanceMap.entries())
            .filter(([, { score }]) => score >= minRelevanceScore)
            .sort(([, a], [, b]) => b.score - a.score);

        const finalUserIds = sortedUserEntries.slice(0, maxRelevantUsers).map(([userId]) => userId);

        // 增强日志，方便观察和调试
        const topUsersDebugInfo = sortedUserEntries
            .slice(0, 5)
            .map(
                ([id, data]) => `\n  - User ${id}: score=${data.score.toFixed(2)}, reasons=[${data.reasons.join(", ")}]`
            )
            .join("");

        /* prettier-ignore */
        this.logger.debug(`智能筛选用户: 候选 ${relevanceMap.size} 个，最终选择 ${finalUserIds.length} 个`);
        return finalUserIds;
    }

    // 模拟一个函数，用于获取拥有有效/最新用户画像的用户ID列表
    // 在实际应用中，这应该是一个高效的查询，例如从Redis Set或数据库中获取
    private async getActiveUserIdsWithProfiles(allCandidateIds: string[]): Promise<Set<string>> {
        // 在真实场景中，这里会调用用户服务或数据库查询
        // a. 传入所有候选人ID
        // b. 用户服务返回其中哪些ID有可用的画像
        // c. 返回一个 Set 以便快速查找
        // this.logger.debug(`正在为 ${allCandidateIds.length} 个候选用户检查画像可用性...`);
        // // 模拟: 假设有一半的用户有画像
        // const usersWithProfiles = new Set<string>();
        // allCandidateIds.forEach((id, index) => {
        //     if (index % 2 === 0) {
        //         // 简单模拟
        //         usersWithProfiles.add(id);
        //     }
        // });
        const usersWithProfiles = new Set<string>();
        const profiles = await this.ctx.database.get(TableName.UserProfiles, {
            userId: { $in: allCandidateIds },
            isDeleted: false,
        });
        profiles.forEach((profile) => {
            usersWithProfiles.add(profile.userId);
        });
        this.logger.debug(`发现 ${usersWithProfiles.size} 个用户拥有可用画像。`);
        return usersWithProfiles;
    }

    public async getUserProfiles(userIds: string[], contextId: string): Promise<UserProfile[]> {
        if (userIds.length === 0) return [];

        const profiles: UserProfile[] = [];
        const missingUserIds = new Set<string>();

        for (const userId of userIds) {
            missingUserIds.add(userId);
        }

        if (missingUserIds.size > 0) {
            const missingProfiles = await this.ctx.database.get(TableName.UserProfiles, {
                userId: { $in: Array.from(missingUserIds) },
                contextId,
                isDeleted: false,
            });
            for (const profile of missingProfiles) {
                profiles.push(profile);
                missingUserIds.delete(profile.userId);
            }

            const globalProfiles = await this.ctx.database.get(TableName.UserProfiles, {
                userId: { $in: Array.from(missingUserIds) },
                contextId: "global",
                isDeleted: false,
            });

            for (const profile of globalProfiles) {
                profiles.push(profile);
                missingUserIds.delete(profile.userId);
            }

            if (missingUserIds.size > 0) {
                this.logger.warn(`无法找到部分用户画像: ${Array.from(missingUserIds).join(", ")}`);
            }
        }
        return profiles;
    }

    /**
     * 基于语义相似度查找相关用户
     * @param messages
     * @param maxUsers
     * @returns
     */
    /* prettier-ignore */
    private async findSemanticRelevantUsers(messages: ContextualMessage[], maxUsers: number): Promise<Array<{ userId: string; score: number }>> {
        try {
            const batchText = messages.map((m) => `${m.sender.name}: ${cleanContent(m.content)}`).join("\n");

            const searchResults = await this.memoryService.searchMemories(batchText, { limit: 30 });

            if (!searchResults.success) {
                this.logger.warn(`语义用户查找失败: ${searchResults.error}`);
                return [];
            }

            const factResults = searchResults.data.filter((item) => item.source === "fact");
            const insightResults = searchResults.data.filter((item) => item.source === "insight");
            const profileResults = searchResults.data.filter((item) => item.source === "profile");

            const userScores = new Map<string, number>();

            factResults.forEach((fact: Fact) => {
                const score = (fact.salience || 0.5) * 0.8;
                userScores.set(fact.userId, Math.max(userScores.get(fact.userId) || 0, score));
            });
            // insightResults.forEach((profile: Insight) => {
            //     const score = profile.salience || 0.5;
            //     userScores.set(profile.userId, Math.max(userScores.get(profile.userId) || 0, score));
            // });
            profileResults.forEach((profile: UserProfile) => {
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

    /**
     * 基于姓名提及查找用户
     * @param messages
     * @returns
     */
    private async findNamedUsers(messages: ContextualMessage[]): Promise<Array<{ userId: string; score: number }>> {
        try {
            const messageText = messages.map((m) => cleanContent(m.content)).join(" ");
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
}

function cleanContent(content: string): string {
    const allowedTypes = ["text", "at", "image"];
    return h
        .parse(content)
        .filter((el) => allowedTypes.includes(el.type))
        .map((el) => {
            if (el.type === "at") return `@${el.attrs.name}`.replace("@@", "@") || `@${el.attrs.id}`;
            if (el.type === "image") return el.attrs.summary || "[图片]";
            return el.toString();
        })
        .join("")
        .replace(/\n/g, " ")
        .trim();
}
