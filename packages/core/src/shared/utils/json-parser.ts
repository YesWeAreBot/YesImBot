import { jsonrepair } from "jsonrepair";
import { Logger } from "koishi";

export interface ParserOptions {
    debug?: boolean;
    logger?: Logger;
}

export interface ParseResult<T> {
    data: T | null;
    error: string | null;
    logs: string[];
}

const defaultLogger: Logger = {
    info: (message) => console.log(`[INFO] ${message}`),
    warn: (message) => console.warn(`[WARN] ${message}`),
    error: (message) => console.error(`[ERROR] ${message}`),
} as Logger;

export class JsonParser<T> {
    private readonly options: Required<ParserOptions>;
    private logs: string[] = [];

    constructor(options: ParserOptions = {}) {
        this.options = {
            debug: options.debug ?? false,
            logger: options.logger ?? defaultLogger,
        };
    }

    private log(message: string): void {
        if (this.options.debug) {
            this.options.logger.info(message);
        }
        this.logs.push(`[日志] ${message}`);
    }

    public parse(rawOutput: string): ParseResult<T> {
        this.logs = [];
        this.log(`开始解析，原始输入长度: ${rawOutput.length}`);

        let processedString = rawOutput.trim();

        // 通过比较 '```' 和 '{' 或 '[' 的首次出现位置，来智能判断是否要提取 Markdown 代码块。
        // 这可以正确处理带有前言的输出，同时避免错误提取 JSON 字符串值中的代码块。
        const codeBlockStartIndex = processedString.indexOf("```");
        const firstBraceIndex = processedString.indexOf("{");
        const firstBracketIndex = processedString.indexOf("[");

        // 查找第一个 JSON 符号的位置（'{' 或 '['）
        let firstJsonCharIndex = -1;
        if (firstBraceIndex !== -1 && firstBracketIndex !== -1) {
            firstJsonCharIndex = Math.min(firstBraceIndex, firstBracketIndex);
        } else if (firstBraceIndex !== -1) {
            firstJsonCharIndex = firstBraceIndex;
        } else {
            firstJsonCharIndex = firstBracketIndex;
        }

        // 如果找到了代码块，并且它出现在第一个JSON符号之前（或者根本没有JSON符号）
        // 那么我们就提取代码块中的内容。
        if (codeBlockStartIndex !== -1 && (firstJsonCharIndex === -1 || codeBlockStartIndex < firstJsonCharIndex)) {
            const markdownMatch = processedString.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
            if (markdownMatch && markdownMatch[1]) {
                this.log("从 Markdown 代码块中提取了内容。");
                processedString = markdownMatch[1].trim();
            }
        }

        const firstBrace = processedString.indexOf("{");
        const firstBracket = processedString.indexOf("[");
        let startIndex = -1;

        if (firstBrace !== -1 && firstBracket !== -1) {
            startIndex = Math.min(firstBrace, firstBracket);
        } else if (firstBrace !== -1) {
            startIndex = firstBrace;
        } else {
            startIndex = firstBracket;
        }

        if (startIndex > 0) {
            this.log(`在索引 ${startIndex} 处找到 JSON 起始符号，丢弃了前面的文本。`);
            processedString = processedString.substring(startIndex);
        }

        // After initial stripping, find the last closing bracket/brace to remove trailing text
        const lastBrace = processedString.lastIndexOf("}");
        const lastBracket = processedString.lastIndexOf("]");
        const endIndex = Math.max(lastBrace, lastBracket);

        if (endIndex > -1 && endIndex < processedString.length - 1) {
            this.log(`裁剪了 JSON 结束符号之后的多余文本。`);
            processedString = processedString.substring(0, endIndex + 1);
        }

        if (startIndex === -1) {
            this.log("未找到 JSON 起始符号，将尝试直接修复整个字符串。");
        }

        try {
            const repaired = jsonrepair(processedString);
            const data = JSON.parse(repaired) as T;

            if (typeof data === "string" && startIndex === -1) {
                this.log("解析结果为字符串，但原始输入不像JSON，判定为解析失败。");
                return { data: null, error: "无法解析为有效的 JSON 对象或数组。", logs: this.logs };
            }

            this.log("解析流程成功完成。");
            return { data, error: null, logs: this.logs };
        } catch (e: any) {
            this.log(`最终解析失败: ${e.message}`);
            return { data: null, error: e.message, logs: this.logs };
        }
    }
}
