import { Context } from "koishi";
import { ChatMessage } from "../database";

// 消息关联类型
export type MessageRelationType =
    | "topic_continuation" // 话题延续
    | "topic_shift" // 话题转移
    | "response_to_previous" // 回应之前的消息
    | "new_topic" // 全新话题
    | "side_conversation"; // 旁支对话

// 话题状态
export type TopicStatus =
    | "developing" // 正在发展
    | "stable" // 稳定讨论
    | "cooling" // 逐渐冷却
    | "ended"; // 已结束

// 消息分析结果
export interface MessageAnalysis {
    messageId: string;
    relationType: MessageRelationType;
    topicId?: string;
    referencedMessageIds: string[];
    confidence: number; // 0-1，分析的置信度
    timestamp: Date;
}

// 话题分析结果
export interface TopicAnalysis {
    topicId: string;
    status: TopicStatus;
    participants: Set<string>;
    lastActivity: Date;
    messageCount: number;
    keywords: string[];
    stability: number; // 话题稳定性 0-1
}

// 对话流状态
export interface ConversationFlow {
    activeTopics: Map<string, TopicAnalysis>;
    recentMessages: MessageAnalysis[];
    conversationPace: "fast" | "normal" | "slow";
    lastAnalysisTime: Date;
}

// 回复决策结果
export interface ReplyDecision {
    shouldReply: boolean;
    reason: string;
    confidence: number;
    suggestedWaitTime?: number;
}

export class ConversationFlowAnalyzer {
    private flows = new Map<string, ConversationFlow>();
    private readonly maxRecentMessages = 15;
    private readonly topicTimeoutMs = 10 * 60 * 1000; // 10分钟话题超时

    constructor(private ctx: Context) {}

    /**
     * 分析新消息并更新对话流
     */
    public async analyzeMessage(channelId: string, message: ChatMessage): Promise<MessageAnalysis> {
        let flow = this.flows.get(channelId);
        if (!flow) {
            flow = {
                activeTopics: new Map(),
                recentMessages: [],
                conversationPace: "normal",
                lastAnalysisTime: new Date(),
            };
            this.flows.set(channelId, flow);
        }

        // 分析消息关联性
        const analysis = await this.analyzeMessageRelation(message, flow);

        // 更新对话流状态
        this.updateConversationFlow(flow, analysis, message);

        // 清理过期话题
        this.cleanupExpiredTopics(flow);

        return analysis;
    }

    /**
     * 判断是否适合回复
     */
    public shouldReply(channelId: string, currentMessage: ChatMessage): ReplyDecision {
        const flow = this.flows.get(channelId);
        if (!flow) {
            return { shouldReply: false, reason: "no_flow_data", confidence: 0 };
        }

        // 如果被@，立即回复
        if (this.isDirectMention(currentMessage)) {
            return {
                shouldReply: true,
                reason: "direct_mention",
                confidence: 1.0,
                suggestedWaitTime: 1000, // 1秒快速响应
            };
        }

        // 分析话题状态
        const topicAnalysis = this.analyzeTopicReadiness(flow);

        // 分析对话节奏
        const paceAnalysis = this.analyzePaceReadiness(flow);

        // 综合判断
        const confidence = (topicAnalysis.confidence + paceAnalysis.confidence) / 2;
        const shouldReply = confidence > 0.6;

        // 计算建议等待时间
        const suggestedWaitTime = this.calculateSuggestedWaitTime(flow, topicAnalysis, paceAnalysis);

        return {
            shouldReply,
            reason: shouldReply ? topicAnalysis.reason : "topic_still_developing",
            confidence,
            suggestedWaitTime,
        };
    }

    /**
     * 分析消息关联性
     */
    private async analyzeMessageRelation(message: ChatMessage, flow: ConversationFlow): Promise<MessageAnalysis> {
        const recentMessages = flow.recentMessages.slice(-8); // 分析最近8条消息

        // 提取关键词
        const keywords = this.extractKeywords(message.content as string);
        let bestMatch: { topicId?: string; confidence: number; type: MessageRelationType } = {
            confidence: 0,
            type: "new_topic",
        };

        // 检查是否与现有话题相关
        for (const [topicId, topic] of flow.activeTopics) {
            const similarity = this.calculateTopicSimilarity(keywords, topic.keywords);
            if (similarity > bestMatch.confidence) {
                bestMatch = {
                    topicId,
                    confidence: similarity,
                    type: similarity > 0.7 ? "topic_continuation" : "topic_shift",
                };
            }
        }

        // 检查是否回应之前的消息
        const referencedMessages = this.findReferencedMessages(message, recentMessages);
        if (referencedMessages.length > 0 && bestMatch.confidence < 0.8) {
            bestMatch = {
                confidence: 0.8,
                type: "response_to_previous",
            };
        }

        return {
            messageId: message.messageId,
            relationType: bestMatch.type,
            topicId: bestMatch.topicId,
            referencedMessageIds: referencedMessages,
            confidence: bestMatch.confidence,
            timestamp: message.timestamp,
        };
    }

    /**
     * 更新对话流状态
     */
    private updateConversationFlow(flow: ConversationFlow, analysis: MessageAnalysis, message: ChatMessage): void {
        // 添加到最近消息
        flow.recentMessages.push(analysis);
        if (flow.recentMessages.length > this.maxRecentMessages) {
            flow.recentMessages.shift();
        }

        // 更新话题状态
        if (analysis.topicId) {
            const topic = flow.activeTopics.get(analysis.topicId);
            if (topic) {
                topic.lastActivity = analysis.timestamp;
                topic.messageCount++;
                topic.participants.add(message.sender.id);
                topic.status = this.determineTopicStatus(topic, flow.recentMessages);

                // 更新关键词
                const newKeywords = this.extractKeywords(message.content as string);
                topic.keywords = [...new Set([...topic.keywords, ...newKeywords])].slice(0, 10);
            }
        } else if (analysis.relationType === "new_topic") {
            // 创建新话题
            const newTopicId = `topic_${Date.now()}_${message.sender.id}`;
            const keywords = this.extractKeywords(message.content as string);

            flow.activeTopics.set(newTopicId, {
                topicId: newTopicId,
                status: "developing",
                participants: new Set([message.sender.id]),
                lastActivity: analysis.timestamp,
                messageCount: 1,
                keywords: keywords,
                stability: 0.1,
            });
        }

        // 更新对话节奏
        flow.conversationPace = this.calculateConversationPace(flow.recentMessages);
        flow.lastAnalysisTime = new Date();
    }

    /**
     * 分析话题准备状态
     */
    private analyzeTopicReadiness(flow: ConversationFlow): { confidence: number; reason: string } {
        const activeTopics = Array.from(flow.activeTopics.values());

        // 如果没有活跃话题，可以回复
        if (activeTopics.length === 0) {
            return { confidence: 0.8, reason: "no_active_topics" };
        }

        // 检查话题是否稳定或冷却
        const stableTopics = activeTopics.filter((t) => t.status === "stable" || t.status === "cooling");
        if (stableTopics.length > 0) {
            return { confidence: 0.7, reason: "topics_stable" };
        }

        // 检查话题是否已经有足够的讨论
        const matureTopics = activeTopics.filter((t) => t.messageCount >= 3);
        if (matureTopics.length > 0) {
            return { confidence: 0.6, reason: "topics_mature" };
        }

        return { confidence: 0.2, reason: "topics_developing" };
    }

    /**
     * 分析节奏准备状态
     */
    private analyzePaceReadiness(flow: ConversationFlow): { confidence: number; reason: string } {
        const recentMessages = flow.recentMessages.slice(-5);
        if (recentMessages.length < 2) {
            return { confidence: 0.5, reason: "insufficient_data" };
        }

        // 计算消息间隔
        const intervals = [];
        for (let i = 1; i < recentMessages.length; i++) {
            const interval = recentMessages[i].timestamp.getTime() - recentMessages[i - 1].timestamp.getTime();
            intervals.push(interval);
        }

        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

        // 如果最近的消息间隔较大，说明对话节奏放缓，适合回复
        if (avgInterval > 30000) {
            // 30秒
            return { confidence: 0.8, reason: "conversation_slowing" };
        }

        // 如果节奏很快，等待一下
        if (avgInterval < 5000) {
            // 5秒
            return { confidence: 0.2, reason: "conversation_too_fast" };
        }

        return { confidence: 0.5, reason: "normal_pace" };
    }

    /**
     * 计算建议等待时间
     */
    private calculateSuggestedWaitTime(
        flow: ConversationFlow,
        topicAnalysis: { confidence: number; reason: string },
        paceAnalysis: { confidence: number; reason: string }
    ): number {
        let baseWaitTime = 3000; // 基础3秒

        // 根据话题状态调整
        switch (topicAnalysis.reason) {
            case "topics_developing":
                baseWaitTime *= 2.0; // 话题发展中，延长等待
                break;
            case "topics_stable":
                baseWaitTime *= 0.8; // 话题稳定，可以适当缩短
                break;
            case "no_active_topics":
                baseWaitTime *= 0.6; // 无活跃话题，可以更快回复
                break;
        }

        // 根据节奏调整
        switch (paceAnalysis.reason) {
            case "conversation_too_fast":
                baseWaitTime *= 2.5; // 对话太快，大幅延长
                break;
            case "conversation_slowing":
                baseWaitTime *= 0.5; // 对话放缓，可以更快插入
                break;
        }

        return Math.max(1000, Math.min(baseWaitTime, 8000)); // 限制在1-8秒
    }

    /**
     * 提取关键词
     */
    private extractKeywords(content: string): string[] {
        // 简化的关键词提取
        const cleanContent = content
            .toLowerCase()
            .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const words = cleanContent
            .split(" ")
            .filter((word) => word.length > 1)
            .filter((word) => !this.isStopWord(word));

        return [...new Set(words)].slice(0, 5);
    }

    /**
     * 判断是否为停用词
     */
    private isStopWord(word: string): boolean {
        const stopWords = new Set([
            "的",
            "了",
            "是",
            "在",
            "我",
            "你",
            "他",
            "她",
            "它",
            "这",
            "那",
            "有",
            "和",
            "与",
            "就",
            "都",
            "要",
            "会",
            "能",
            "可以",
            "不是",
            "the",
            "a",
            "an",
            "and",
            "or",
            "but",
            "in",
            "on",
            "at",
            "to",
            "for",
            "of",
            "with",
            "by",
            "is",
            "are",
            "was",
            "were",
            "be",
        ]);
        return stopWords.has(word);
    }

    /**
     * 计算话题相似度
     */
    private calculateTopicSimilarity(keywords1: string[], keywords2: string[]): number {
        if (keywords1.length === 0 || keywords2.length === 0) return 0;

        const set1 = new Set(keywords1);
        const set2 = new Set(keywords2);
        const intersection = new Set([...set1].filter((k) => set2.has(k)));
        const union = new Set([...set1, ...set2]);

        return intersection.size / union.size;
    }

    /**
     * 查找引用的消息
     */
    private findReferencedMessages(message: ChatMessage, recentMessages: MessageAnalysis[]): string[] {
        const content = message.content as string;
        const replyKeywords = ["回复", "回应", "@", "刚才", "上面", "之前", "刚刚"];

        if (replyKeywords.some((keyword) => content.includes(keyword))) {
            return recentMessages.slice(-3).map((m) => m.messageId);
        }

        return [];
    }

    /**
     * 确定话题状态
     */
    private determineTopicStatus(topic: TopicAnalysis, recentMessages: MessageAnalysis[]): TopicStatus {
        const now = Date.now();
        const timeSinceLastActivity = now - topic.lastActivity.getTime();

        // 超过10分钟，话题结束
        if (timeSinceLastActivity > 10 * 60 * 1000) {
            return "ended";
        }

        // 超过5分钟没有相关消息，话题冷却
        if (timeSinceLastActivity > 5 * 60 * 1000) {
            return "cooling";
        }

        // 根据消息数量和参与者判断
        if (topic.messageCount >= 5 && topic.participants.size >= 2) {
            return "stable";
        }

        return "developing";
    }

    /**
     * 计算对话节奏
     */
    private calculateConversationPace(recentMessages: MessageAnalysis[]): "fast" | "normal" | "slow" {
        if (recentMessages.length < 3) return "normal";

        const intervals = [];
        for (let i = 1; i < Math.min(recentMessages.length, 6); i++) {
            const interval = recentMessages[i].timestamp.getTime() - recentMessages[i - 1].timestamp.getTime();
            intervals.push(interval);
        }

        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

        if (avgInterval < 10000) return "fast"; // 10秒内
        if (avgInterval > 60000) return "slow"; // 1分钟以上
        return "normal";
    }

    /**
     * 检查是否直接提及
     */
    private isDirectMention(message: ChatMessage): boolean {
        const content = message.content as string;
        // 简化的@检测，实际应该检查具体的@目标
        return (
            content.includes("@") ||
            content.includes("机器人") ||
            content.includes("bot") ||
            content.includes("AI") ||
            content.includes("助手")
        );
    }

    /**
     * 清理过期话题
     */
    private cleanupExpiredTopics(flow: ConversationFlow): void {
        const now = Date.now();
        for (const [topicId, topic] of flow.activeTopics) {
            if (now - topic.lastActivity.getTime() > this.topicTimeoutMs) {
                flow.activeTopics.delete(topicId);
            }
        }
    }

    /**
     * 获取对话流状态
     */
    public getConversationFlow(channelId: string): ConversationFlow | null {
        return this.flows.get(channelId) || null;
    }

    /**
     * 获取调试信息
     */
    public getDebugInfo(channelId: string): any {
        const flow = this.flows.get(channelId);
        if (!flow) return null;

        return {
            activeTopicsCount: flow.activeTopics.size,
            recentMessagesCount: flow.recentMessages.length,
            conversationPace: flow.conversationPace,
            topics: Array.from(flow.activeTopics.values()).map((topic) => ({
                id: topic.topicId,
                status: topic.status,
                messageCount: topic.messageCount,
                participantsCount: topic.participants.size,
                keywords: topic.keywords,
            })),
        };
    }
}
