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

        const markdownMatch = processedString.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
        if (markdownMatch && markdownMatch[1]) {
            this.log("从 Markdown 代码块中提取了内容。");
            processedString = markdownMatch[1].trim();
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

        if (endIndex > -1 && endIndex < processedString.length -1) {
             this.log(`裁剪了 JSON 结束符号之后的多余文本。`);
             processedString = processedString.substring(0, endIndex + 1);
        }

        if (startIndex === -1) {
            this.log("未找到 JSON 起始符号，将尝试直接修复整个字符串。");
        }

        try {
            const repaired = jsonrepair(processedString);
            const data = JSON.parse(repaired) as T;

            if (typeof data === 'string' && startIndex === -1) {
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