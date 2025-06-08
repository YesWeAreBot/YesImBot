import { ChatMessage, Interaction } from "../../types/model";

// 统一的消息类型
export type Message = ChatMessage | Interaction;

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
}
