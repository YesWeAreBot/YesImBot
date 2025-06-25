import { Context } from "koishi";
import { FlowAnalysis } from "./conversation-flow-analyzer";

export interface WillingnessConfig {
    TestMode: boolean;
    AtMentionProbability: number;
    Threshold: number;
    Weight: {
        BaseMessage: number;
        AtMention: number;
        Keyword: number;
    };
    DecayPerMinute: number;
    RetentionAfterReply: number;
    Keywords: string[];
}

// 定义意愿计算结果的接口
export interface Willingness {
    value: number; // 0-1 的最终意愿值
    threshold: number; // 触发行动所需的阈值
    shouldAct: boolean; // 最终决策
    reasons: string[]; // 决策理由，用于日志和调试
}

export class WillingnessCalculator {
    constructor(private ctx: Context, private config: WillingnessConfig) {}

    /**
     * 新的核心方法：计算行动意愿
     */
    public calculate(analysis: FlowAnalysis, currentWillingness: number /* TODO: 以后加入 agentState */): Willingness {
        const weights = this.config.Weight;
        let baseWillingness = 0;
        const reasons: string[] = [];

        // 1. 基于 @提及 的计算
        if (analysis.isAgentMentioned) {
            baseWillingness += weights.AtMention;
            reasons.push(`Agent被提及 (w+${weights.AtMention})`);
        }

        // 2. 基于对话强度的计算
        // const intensityBonus = analysis.intensity * weights.Intensity;
        const intensityBonus = analysis.intensity * 1;
        baseWillingness += intensityBonus;
        reasons.push(`对话强度 ${analysis.intensity.toFixed(2)} (w+${intensityBonus.toFixed(2)})`);

        // 3. 基于对话节奏的调整
        let paceMultiplier = 1.0;
        // if (analysis.pace === "slow") {
        //     paceMultiplier = weights.Pace.Slow;
        //     reasons.push(`对话节奏缓慢 (w*${paceMultiplier})`);
        // } else if (analysis.pace === "fast") {
        //     paceMultiplier = weights.Pace.Fast;
        //     reasons.push(`对话节奏快 (w*${paceMultiplier})`);
        // }
        baseWillingness *= paceMultiplier;

        // 4. 基于关键词的计算 (此处简化，实际应与 analysis.keywords 结合)
        // TODO: 添加关键词匹配逻辑

        // 5. 限制最终值在 0-1 之间
        const finalWillingness = Math.max(0, Math.min(1, baseWillingness));
        const threshold = this.config.Threshold;
        const shouldAct = finalWillingness >= threshold;

        return {
            value: finalWillingness,
            threshold: threshold,
            shouldAct: shouldAct,
            reasons: reasons,
        };
    }
}
