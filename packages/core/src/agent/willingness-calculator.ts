import { Context } from "koishi";
import { FlowAnalysis } from "./conversation-flow-analyzer";
import { WillingnessConfig } from "./config";

// 定义意愿计算结果的接口
export interface Willingness {
    value: number; // 最终意愿分数
    threshold: number; // 触发行动所需的分数阈值
    shouldAct: boolean; // 最终决策
    reasons: string[]; // 决策理由，用于日志和调试
}

export class WillingnessCalculator {
    constructor(private ctx: Context, private config: WillingnessConfig) {}

    /**
     * 新的核心方法：计算行动意愿
     */
    public calculate(analysis: FlowAnalysis, currentWillingness: number): Willingness {
        const weights = this.config.weights;
        let score = currentWillingness; // 从当前的意愿值开始累加
        const reasons: string[] = [`Initial score: ${currentWillingness.toFixed(2)}`];

        // 1. 基于 @提及 的计算
        if (analysis.isAgentMentioned) {
            score += weights.atMention;
            reasons.push(`Agent mentioned (+${weights.atMention})`);
        }

        // 2. 基于消息类型
        if (analysis.hasTextMessage) {
            score += weights.textMessage;
            reasons.push(`Text message (+${weights.textMessage})`);
        }
        if (analysis.hasImageMessage) {
            score += weights.imageMessage;
            reasons.push(`Image message (+${weights.imageMessage})`);
        }
        if (analysis.hasQuote) {
            score += weights.quoteMessage;
            reasons.push(`Quote message (+${weights.quoteMessage})`);
        }

        // 3. 基于系统事件
        if (analysis.hasCommandInvocation) {
            score += weights.commandInvocation;
            reasons.push(`Command invoked (+${weights.commandInvocation})`);
        }

        // 4. 基于关键词的计算
        if (analysis.matchingKeywords.length > 0) {
            score += weights.keyword;
            reasons.push(`Keywords matched: ${analysis.matchingKeywords.join(", ")} (+${weights.keyword})`);
        }

        // 5. 限制最终值在 0 以上
        const finalScore = Math.max(0, score);
        const threshold = this.config.threshold;
        let shouldAct = finalScore >= threshold;

        reasons.push(`Final Score: ${finalScore.toFixed(2)} / ${threshold}`);

        if (this.config.advanced.testMode) {
            shouldAct = true;
            reasons.push("Test mode enabled, forcing action.");
        }

        return {
            value: finalScore,
            threshold: threshold,
            shouldAct: shouldAct,
            reasons: reasons,
        };
    }
}
