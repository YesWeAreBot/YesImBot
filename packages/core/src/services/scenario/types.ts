import { ChatMessage, Interaction } from "../../types/model";

// 统一的消息类型
export type Message = ChatMessage | Interaction;

// 消息关联类型
export type MessageRelationType =
    | 'topic_continuation'    // 话题延续
    | 'topic_shift'          // 话题转移
    | 'response_to_previous' // 回应之前的消息
    | 'new_topic'           // 全新话题
    | 'side_conversation';   // 旁支对话

// 话题状态
export type TopicStatus =
    | 'developing'    // 正在发展
    | 'stable'        // 稳定讨论
    | 'cooling'       // 逐渐冷却
    | 'ended';        // 已结束

// 对话节奏
export type ConversationPace = 'fast' | 'medium' | 'slow';

// 参与度等级
export type EngagementLevel = 'high' | 'medium' | 'low';

// 参与者角色
export type Role = 'leader' | 'active_participant' | 'observer' | 'participant';

// 话题转换
export interface TopicTransition {
    fromTopic: string;
    toTopic: string;
    transitionPoint: Date;
    triggeredBy: string;
    transitionType: 'natural' | 'abrupt' | 'return';
}

// 对话动态
export interface ConversationDynamics {
    messageFrequency: number; // 每分钟消息数
    averageResponseTime: number; // 平均响应时间(秒)
    emotionalTone: 'positive' | 'negative' | 'neutral';
    engagementLevel: EngagementLevel;
    conversationPace: ConversationPace;
    dominantSpeakers: Array<{
        userId: string;
        messageCount: number;
        dominanceRatio: number;
    }>;
}

// 参与者角色分析
export interface ParticipantRole {
    userId: string;
    name: string;
    role: Role;
    influence: number; // 影响力 0-1
    activityLevel: number; // 活跃度 0-1
    responsePattern: 'active' | 'reactive' | 'normal';
    topicInitiation: number; // 话题发起次数
}

// LLM分析后的话题摘要
export interface TopicSummary {
    topic: string; // 话题的简短标题
    summary: string; // 对话题内容的详细摘要
    participants: { id: string, name: string }[]; // 话题的主要参与者
}

// 完整的对话摘要
export interface ConversationSummary {
    overallSummary: string; // 对当前所有新消息的总体概览
    activeTopics: TopicSummary[]; // 识别出的活跃话题列表
    // 增强的分析结果
    dynamics?: ConversationDynamics;
    topicTransitions?: TopicTransition[];
    participantRoles?: ParticipantRole[];
    analysisTimestamp?: Date;
}
