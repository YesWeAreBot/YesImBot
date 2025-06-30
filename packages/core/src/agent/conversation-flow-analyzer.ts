import { Context } from "koishi";
import { DialogueSegment, SystemEvent } from "../services";

// 定义分析结果的接口
export interface FlowAnalysis {
    pace: "fast" | "normal" | "slow";
    intensity: number; // 0-1, 对话激烈程度
    participantCount: number;
    mainTopicStatus: "developing" | "stable" | "cooling" | "ended" | "none";
    isAgentMentioned: boolean;
    keywords: string[];
}

export class ConversationFlowAnalyzer {
    // 旧的 ConversationFlowAnalyzer 内部大部分逻辑可以迁移至此
    // 例如：extractKeywords, calculateConversationPace, isStopWord 等

    constructor(private ctx: Context) {}

    /**
     * 新的核心方法：分析整个对话片段
     */
    public analyze(segment: DialogueSegment): FlowAnalysis {
        const events = segment.systemEvents;
        if (events.length === 0) {
            return this.defaultAnalysis();
        }

        const pace = this.calculatePace(events);
        const intensity = this.calculateIntensity(events);
        const participantCount = new Set(events.map((e) => (e.payload as any).actor?.id).filter(Boolean)).size;
        const isAgentMentioned = this.checkForMentions(events);

        // TODO: 可以引入更复杂的话题分析逻辑，暂时简化
        const mainTopicStatus = this.determineTopicStatus(events);

        // TODO: 从事件内容中提取关键词
        const keywords = this.extractKeywordsFromEvents(events);

        return {
            pace,
            intensity,
            participantCount,
            mainTopicStatus,
            isAgentMentioned,
            keywords,
        };
    }

    private defaultAnalysis(): FlowAnalysis {
        return {
            pace: "slow",
            intensity: 0,
            participantCount: 0,
            mainTopicStatus: "none",
            isAgentMentioned: false,
            keywords: [],
        };
    }

    private calculatePace(events: SystemEvent[]): "fast" | "normal" | "slow" {
        if (events.length < 2) return "slow";
        const lastTwoEvents = events.slice(-2);
        const intervalMs = lastTwoEvents[1].timestamp.getTime() - lastTwoEvents[0].timestamp.getTime();

        if (intervalMs < 5000) return "fast"; // 5秒内
        if (intervalMs > 30000) return "slow"; // 30秒以上
        return "normal";
    }

    private calculateIntensity(events: SystemEvent[]): number {
        // 简单的强度计算：基于最近5分钟内的消息数量
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        const recentEvents = events.filter((e) => e.timestamp.getTime() > fiveMinutesAgo);
        // 将数量映射到 0-1 的范围，例如超过10条就是最高强度
        return Math.min(1, recentEvents.length / 10);
    }

    private checkForMentions(events: SystemEvent[]): boolean {
        // 从旧代码的 isDirectMention 迁移逻辑
        const agentNames = ["letta", "莱塔", "机器人", "bot"]; // 应从配置读取
        return events.some((e) => {
            if (e.type === "message") {
                const content = (e.payload as any).content?.toLowerCase() || "";
                // 检查 @ 和关键词
                return content.includes('<at id="') || agentNames.some((name) => content.includes(name));
            }
            return false;
        });
    }

    private determineTopicStatus(events: SystemEvent[]): "developing" | "stable" | "cooling" | "ended" {
        // 从旧代码的 determineTopicStatus 迁移简化逻辑
        if (events.length >= 5) return "stable";
        if (events.length >= 2) return "developing";
        return "cooling";
    }

    private extractKeywordsFromEvents(events: SystemEvent[]): string[] {
        // TODO: 实现从事件内容中提取关键词的逻辑
        return [];
    }
}
