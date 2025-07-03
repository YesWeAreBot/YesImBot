import { Context, h } from "koishi";
import { DialogueSegment, SystemEvent } from "../services";

// 定义分析结果的接口
export interface FlowAnalysis {
    isAgentMentioned: boolean;
    matchingKeywords: string[];
    hasTextMessage: boolean;
    hasImageMessage: boolean;
    hasQuote: boolean;
    hasCommandInvocation: boolean;
    // 保留未来扩展的可能性
    participantCount: number;
}

export class ConversationFlowAnalyzer {
    constructor(private ctx: Context) {}

    /**
     * 新的核心方法：分析整个对话片段
     */
    public analyze(segment: DialogueSegment, agentKeywords: string[]): FlowAnalysis {
        let isAgentMentioned = false;
        const matchingKeywords = new Set<string>();
        let hasTextMessage = false;
        let hasImageMessage = false;
        let hasQuote = false;

        let hasCommandInvocation = false;

        // 1. 分析消息内容 (Dialogue)
        for (const msg of segment.dialogue) {
            const elements = h.parse(msg.content);

            if (elements.some((el) => el.type === "text" && el.attrs.content.trim().length > 0)) {
                hasTextMessage = true;
            }
            if (elements.some((el) => el.type === "image" || el.type === "img")) {
                hasImageMessage = true;
            }
            if (msg.quoteId) {
                hasQuote = true;
            }

            // 检查 @ 和关键词
            const fullText = elements.map((el) => el.toString()).join("");

            for (const keyword of agentKeywords) {
                if (fullText.toLowerCase().includes(keyword.toLowerCase())) {
                    matchingKeywords.add(keyword);
                }
            }
        }

        // 2. 分析系统事件 (SystemEvents)
        for (const event of segment.systemEvents) {
            if (event.type === "command-invoked") {
                hasCommandInvocation = true;
            }
        }

        const participantCount = new Set(segment.dialogue.map((m) => m.sender.pid).filter(Boolean)).size;

        return {
            isAgentMentioned,
            matchingKeywords: Array.from(matchingKeywords),
            hasTextMessage,
            hasImageMessage,
            hasQuote,
            hasCommandInvocation,
            participantCount,
        };
    }
}
