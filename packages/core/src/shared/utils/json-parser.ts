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

        // 优先检测并提取 Markdown 代码块。
        // 如果存在代码块，我们假定这才是我们真正需要解析的内容。
        const codeBlockStartIndex = processedString.indexOf("```");
        const trimmedStringStartsWithJson = processedString.startsWith("{") || processedString.startsWith("[");

        // 新的、更智能的代码块提取逻辑：
        // 仅当检测到代码块，并且整个字符串的开头不是有效的JSON字符时，
        // 才认为代码块是需要提取的主体。
        if (codeBlockStartIndex !== -1 && !trimmedStringStartsWithJson) {
            const lastCodeBlockIndex = processedString.lastIndexOf("```");
            // 确保我们找到了一个开始和一个结束标记
            if (lastCodeBlockIndex > codeBlockStartIndex) {
                this.log("检测到 Markdown 代码块，且原始字符串不以 JSON 开头，优先提取块内容。");

                // 提取两个 ``` 之间的内容
                let content = processedString.substring(codeBlockStartIndex + 3, lastCodeBlockIndex);

                // 移除可能的语言标识符，如 'json'
                const firstNewlineIndex = content.indexOf("\n");
                if (firstNewlineIndex !== -1) {
                    const firstLine = content.substring(0, firstNewlineIndex).trim();
                    // 简单的检查，避免误删JSON内容。如果第一行不像JSON的开始，就移除它。
                    if (!firstLine.startsWith("{") && !firstLine.startsWith("[")) {
                        this.log(`移除了可能的语言标识符或前导文本: "${firstLine}"`);
                        content = content.substring(firstNewlineIndex + 1);
                    }
                }

                processedString = content.trim();
                this.log(`从代码块提取并修整后，待处理字符串长度: ${processedString.length}`);
            }
        } else if (codeBlockStartIndex !== -1) {
            this.log("检测到代码块，但字符串似乎已是有效JSON，跳过提取。");
        }

        // 现在，无论 `processedString` 是来自代码块还是原始输入，
        // 我们都应用相同的后续清理逻辑。

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

        if (startIndex === -1) {
            this.log("未找到 JSON 起始符号，将尝试直接修复整个字符串。");
        } else {
            if (startIndex > 0) {
                this.log(`在索引 ${startIndex} 处找到 JSON 起始符号，丢弃了前面的 ${startIndex} 个字符。`);
                processedString = processedString.substring(startIndex);
            }
        }

        // 只有当括号/大括号是平衡的，我们才认为后面有多余文本。
        // 否则，我们假设是JSON被截断，不进行裁剪。
        const openBraces = (processedString.match(/{/g) || []).length;
        const closeBraces = (processedString.match(/}/g) || []).length;
        const openBrackets = (processedString.match(/\[/g) || []).length;
        const closeBrackets = (processedString.match(/]/g) || []).length;

        if (openBraces === closeBraces && openBrackets === closeBrackets) {
            const lastBrace = processedString.lastIndexOf("}");
            const lastBracket = processedString.lastIndexOf("]");
            const endIndex = Math.max(lastBrace, lastBracket);

            if (endIndex > -1 && endIndex < processedString.length - 1) {
                this.log(`JSON 结构平衡，裁剪了结束符号之后的多余文本。`);
                processedString = processedString.substring(0, endIndex + 1);
            }
        } else {
            /* prettier-ignore */
            this.log(`JSON 结构不平衡 (括号: ${openBrackets}/${closeBrackets}, 大括号: ${openBraces}/${closeBraces})，跳过后缀裁剪以保留可能被截断的数据。`);
        }

        if (processedString.length === 0) {
            return { data: null, error: "无法找到有效的 JSON 内容。", logs: this.logs };
        }

        try {
            const repaired = jsonrepair(processedString);
            const data = JSON.parse(repaired) as T;

            // 如果修复后只是一个字符串或数字，但原始输入明显不是一个独立的JSON字符串/数字，则判定为失败。
            // 这是一个启发式规则，用于避免将"some text { ... }"中的"some text"误解析为成功。
            // `startIndex === -1` 表示我们没有找到明确的 `{` 或 `[`，整个字符串都被拿来解析。
            if (typeof data !== "object" && startIndex === -1) {
                this.log(`解析结果为非对象类型，但原始输入不像独立的JSON值，判定为解析失败。`);
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
