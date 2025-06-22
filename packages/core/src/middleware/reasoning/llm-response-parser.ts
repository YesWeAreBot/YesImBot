import { Logger } from "koishi";
import { JsonParser } from "../../shared/utils";

/**
 * LLM 输出格式接口
 */
export interface LLMOutput {
    thoughts: {
        observe: string;
        analyze_infer: string;
        plan: string;
    };
    actions: {
        function: string;
        params: Record<string, unknown>;
    }[];
    request_heartbeat: boolean;
}

export class LLMResponseParser {
    parser: JsonParser<LLMOutput>;
    constructor(private readonly logger: Logger) {
        this.parser = new JsonParser<LLMOutput>({ logger: this.logger });
    }

    /**
     * 从LLM的原始文本响应中解析出结构化的JSON数据
     * @param text LLM返回的原始文本
     * @returns 解析成功则返回 LLMOutput 对象，否则返回 null
     */
    public parse(text: string): LLMOutput | null {
        if (!text) {
            this.logger.warn("LLM 响应为空，无法解析。");
            return null;
        }

        try {
            const extracted = this.parseAndValidateResponse(text);
            return extracted;
        } catch (error) {
            this.logger.error("解析LLM响应时发生未知错误:", error);
            return null;
        }
    }

    /**
     * 验证解析出的对象是否符合 LLMOutput 格式
     */
    private isValidOutput(data: any): data is LLMOutput {
        return (
            data &&
            typeof data === "object" &&
            "thoughts" in data &&
            "actions" in data &&
            typeof data["request_heartbeat"] === "boolean" &&
            Array.isArray(data["actions"])
        );
    }

    /**
     * 解析和验证响应
     */
    private parseAndValidateResponse(text: string): LLMOutput | null {
        const { data: result, error, logs } = this.parser.parse(text);

        // 验证JSON结构完整性
        if (!result || !result["thoughts"] || !result["actions"] || typeof result["request_heartbeat"] !== "boolean") {
            this.logger.warn("LLM响应结构无效");
            return null;
        }

        return {
            thoughts: result.thoughts,
            actions: result.actions,
            request_heartbeat: result.request_heartbeat,
        };
    }
}
