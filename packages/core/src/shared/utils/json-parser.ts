import { jsonrepair } from "jsonrepair";
import { Logger } from "koishi";

/**
 * @interface ParserOptions
 * @description 解析器配置选项。
 */
export interface ParserOptions {
    /** 是否启用调试模式，输出更详细的日志 */
    debug?: boolean;
    /** 自定义日志记录器，默认为 console */
    logger?: Logger;
    /** 修复策略配置 */
    repairStrategies?: {
        /** 是否尝试从 Markdown 代码块中提取 JSON (```json ... ```) */
        extractFromMarkdown?: boolean;
        /** 是否修复未闭合的对象和数组 */
        fixUnclosedObjects?: boolean;
        /** 是否移除末尾悬垂的不完整键值对（有数据丢失风险） */
        fixDanglingKeys?: boolean;
        /** 是否修复被截断的字符串（在末尾添加引号） */
        fixTruncatedStrings?: boolean;
    };
}

/**
 * @interface ParseResult
 * @description 解析结果封装。
 * @template T - 预期的 JSON 输出类型。
 */
export interface ParseResult<T> {
    /** 解析成功后的数据，若失败则为 null */
    data: T | null;
    /** 解析失败时的错误信息，若成功则为 null */
    error: string | null;
    /** 本次解析过程中的详细操作日志 */
    logs: string[];
}

// 默认的控制台日志记录器
const defaultLogger: Logger = {
    info: (message) => console.log(`[INFO] ${message}`),
    warn: (message) => console.warn(`[WARN] ${message}`),
    error: (message) => console.error(`[ERROR] ${message}`),
} as Logger;

/**
 * @class JsonParser
 * @description 一个为处理大语言模型 (LLM) 输出设计的健壮 JSON 解析器。
 */
export class JsonParser<T> {
    private readonly options: Required<ParserOptions>;
    private logs: string[] = [];

    constructor(options: ParserOptions = {}) {
        this.options = {
            debug: options.debug ?? false,
            logger: options.logger ?? defaultLogger,
            repairStrategies: {
                extractFromMarkdown: options.repairStrategies?.extractFromMarkdown ?? true,
                fixUnclosedObjects: options.repairStrategies?.fixUnclosedObjects ?? true,
                fixDanglingKeys: options.repairStrategies?.fixDanglingKeys ?? true,
                fixTruncatedStrings: options.repairStrategies?.fixTruncatedStrings ?? true,
            },
        };
    }

    /**
     * 记录一条日志，并推送到日志数组中。
     * @param message - 日志内容。
     */
    private log(message: string): void {
        this.options.logger.info(message);
        this.logs.push(`[日志] ${message}`);
    }

    /**
     * [管道阶段 1] 从原始字符串中剥离非 JSON 的包装文本（如 Markdown, 前置说明）。
     * 该方法非常保守，只移除 JSON 开始符号之前的内容，以防意外截断。
     * @param rawOutput - LLM 的原始输出。
     * @returns 可能包含 JSON 的核心字符串。
     */
    private _stripWrapperText(rawOutput: string): string {
        this.log("阶段 1: 剥离无关的包装文本。");
        let stripped = rawOutput.trim();

        // 策略: 从 Markdown 代码块中提取
        if (this.options.repairStrategies.extractFromMarkdown) {
            const markdownMatch = stripped.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
            if (markdownMatch && markdownMatch[1]) {
                this.log("从 Markdown 代码块中提取了内容。");
                stripped = markdownMatch[1].trim();
            }
        }

        // 寻找第一个 '{' 或 '['
        const firstBrace = stripped.indexOf("{");
        const firstBracket = stripped.indexOf("[");

        let startIndex = -1;

        if (firstBrace === -1 && firstBracket === -1) {
            this.log('未找到 JSON 的起始符号 "{" 或 "["。将使用完整字符串进行后续处理。');
            return stripped;
        }

        if (firstBrace !== -1 && firstBracket !== -1) {
            startIndex = Math.min(firstBrace, firstBracket);
        } else if (firstBrace !== -1) {
            startIndex = firstBrace;
        } else {
            // firstBracket !== -1
            startIndex = firstBracket;
        }

        if (startIndex > 0) {
            this.log(`在索引 ${startIndex} 处找到 JSON 起始符号，丢弃了前面的文本。`);
            stripped = stripped.substring(startIndex);
        }

        return stripped;
    }

    /**
     * [管道阶段 2] 寻找一个完整的、闭合的 JSON 对象的边界，并裁剪其后的所有内容。
     * 如果 JSON 本身未闭合，则此方法不进行任何操作。
     * @param jsonStr - 输入的 JSON 字符串。
     * @returns 裁剪后的字符串。
     */
    private _findJsonBoundaryAndTrim(jsonStr: string): string {
        this.log("阶段 2: 寻找 JSON 的实际边界并裁剪多余后缀。");

        let balance = 0;
        let inString = false;
        let boundaryIndex = -1;

        for (let i = 0; i < jsonStr.length; i++) {
            const char = jsonStr[i];

            if (char === '"' && (i === 0 || jsonStr[i - 1] !== "\\")) {
                inString = !inString;
            }

            if (inString) continue;

            if (char === "{" || char === "[") {
                balance++;
            } else if (char === "}" || char === "]") {
                balance--;
            }

            // 当 balance 为 0 时，意味着一个顶层结构闭合了
            if (balance === 0 && boundaryIndex === -1 && (char === "}" || char === "]")) {
                boundaryIndex = i;
            } else if (balance > 0) {
                // 如果平衡再次被打破，重置边界，因为我们还没找到最终的结尾
                boundaryIndex = -1;
            }
        }

        // 如果找到了一个有效的边界，并且后面有多余的非空白字符，则进行裁剪
        if (boundaryIndex !== -1) {
            const suffix = jsonStr.substring(boundaryIndex + 1).trim();
            // 允许末尾是逗号，交给 jsonrepair 处理
            if (suffix.length > 0 && suffix !== ",") {
                const newStr = jsonStr.substring(0, boundaryIndex + 1);
                this.log(`在索引 ${boundaryIndex} 处找到一个平衡的 JSON 结构，裁剪了后面的垃圾字符: "${suffix}"`);
                return newStr;
            }
        }

        this.log("未找到明确的 JSON 结构边界或无多余后缀，不进行裁剪。");
        return jsonStr;
    }

    /**
     * [管道阶段 1] 从原始字符串中提取潜在的 JSON 部分。
     * @param rawOutput - LLM 的原始输出。
     * @returns 提取出的 JSON 字符串或 null。
     */
    private _extractJsonString(rawOutput: string): string {
        this.log("阶段 1: 开始提取 JSON 字符串。");
        let jsonStr = rawOutput.trim();

        // 策略: 从 Markdown 代码块中提取
        if (this.options.repairStrategies.extractFromMarkdown) {
            const markdownMatch = jsonStr.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
            if (markdownMatch) {
                jsonStr = markdownMatch[1];
                this.log("在 Markdown 代码块中找到并提取了内容。");
            }
        }

        // 寻找第一个 '{' 或 '[' 和最后一个 '}' 或 ']'
        const firstBrace = jsonStr.indexOf("{");
        const firstBracket = jsonStr.indexOf("[");
        let startIndex = -1;

        if (firstBrace === -1 && firstBracket === -1) {
            this.log('未找到 JSON 的起始符号 "{" 或 "["。');
            return jsonStr; // 让他去下游尝试修复
        }

        if (firstBrace !== -1 && firstBracket !== -1) {
            startIndex = Math.min(firstBrace, firstBracket);
        } else if (firstBrace !== -1) {
            startIndex = firstBrace;
        } else {
            startIndex = firstBracket;
        }

        const lastBrace = jsonStr.lastIndexOf("}");
        const lastBracket = jsonStr.lastIndexOf("]");
        const endIndex = Math.max(lastBrace, lastBracket);

        if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
            jsonStr = jsonStr.substring(startIndex, endIndex + 1);
            this.log(`根据起始和结束括号提取了核心 JSON。范围: [${startIndex}, ${endIndex}]`);
        } else {
            this.log("无法根据括号定位核心 JSON，将使用清理后的完整字符串。");
        }

        return jsonStr;
    }

    /**
     * [管道阶段 2] 使用栈来修复未闭合的对象和数组。
     * @param jsonStr - 输入的 JSON 字符串。
     * @returns 修复后的字符串。
     */
    private _fixUnclosedStructures(jsonStr: string): string {
        if (!this.options.repairStrategies.fixUnclosedObjects) return jsonStr;

        this.log("阶段 2: 检查并修复未闭合的结构 (对象/数组)。");
        const stack: ("{" | "[")[] = [];
        let inString = false;

        for (let i = 0; i < jsonStr.length; i++) {
            const char = jsonStr[i];

            if (char === '"' && (i === 0 || jsonStr[i - 1] !== "\\")) {
                inString = !inString;
            }

            if (inString) continue;

            if (char === "{" || char === "[") {
                stack.push(char);
            } else if (char === "}") {
                if (stack.length > 0 && stack[stack.length - 1] === "{") {
                    stack.pop();
                }
            } else if (char === "]") {
                if (stack.length > 0 && stack[stack.length - 1] === "[") {
                    stack.pop();
                }
            }
        }

        if (stack.length > 0) {
            let repairedStr = jsonStr;
            while (stack.length > 0) {
                const openChar = stack.pop();
                if (openChar === "{") {
                    repairedStr += "}";
                    this.log('检测到未闭合的 "{"，已在末尾添加 "}"。');
                } else if (openChar === "[") {
                    repairedStr += "]";
                    this.log('检测到未闭合的 "["，已在末尾添加 "]"。');
                }
            }
            return repairedStr;
        }

        this.log("结构完整性检查通过，无需修复。");
        return jsonStr;
    }

    /**
     * [管道阶段 3] 修复悬垂的键值对和截断的字符串。
     * @param jsonStr - 输入的 JSON 字符串。
     * @returns 修复后的字符串。
     */
    private _fixDanglingParts(jsonStr: string): string {
        this.log("阶段 3: 检查并修复悬垂部分。");
        let repairedStr = jsonStr.trim();

        // 策略: 移除末尾悬垂的不完整键值对
        if (this.options.repairStrategies.fixDanglingKeys) {
            const lastComma = repairedStr.lastIndexOf(",");
            const lastBrace = repairedStr.lastIndexOf("}");
            // 如果最后一个逗号在最后一个闭合括号之后，说明有悬垂内容
            if (lastComma > lastBrace && lastBrace !== -1) {
                repairedStr = repairedStr.substring(0, lastComma);
                this.log(`检测到悬垂的键值对，已从最后一个逗号处截断。`);
            }
        }

        // 策略: 修复被截断的字符串
        if (this.options.repairStrategies.fixTruncatedStrings) {
            let quoteCount = 0;
            for (let i = 0; i < repairedStr.length; i++) {
                if (repairedStr[i] === '"' && (i === 0 || repairedStr[i - 1] !== "\\")) {
                    quoteCount++;
                }
            }

            // 如果引号数量为奇数，说明有字符串未闭合
            if (quoteCount % 2 !== 0) {
                repairedStr += '"';
                this.log("检测到未闭合的字符串，已在末尾添加引号。");
            }
        }

        return repairedStr;
    }

    /**
     * [管道阶段 4] 使用 jsonrepair 库进行通用修复。
     * @param jsonStr - 输入的 JSON 字符串。
     * @returns 修复后的字符串。
     */
    private _runStandardRepair(jsonStr: string): string {
        this.log("阶段 4: 运行标准 jsonrepair 库进行通用修复。");
        try {
            const repaired = jsonrepair(jsonStr);
            this.log("jsonrepair 执行完毕。");
            return repaired;
        } catch (e: any) {
            this.log(`jsonrepair 修复失败: ${e.message}`);
            return jsonStr; // 失败则返回原样，让最终解析来捕获
        }
    }

    /**
     * [管道阶段 5] 最终解析。
     * @param jsonStr - 待解析的字符串。
     * @returns 解析后的对象或 null。
     */
    private _finalParse(jsonStr: string): T | null {
        this.log("阶段 5: 尝试最终解析 (JSON.parse)。");
        try {
            const parsed = JSON.parse(jsonStr) as T;
            this.log("JSON.parse 成功！");
            return parsed;
        } catch (e: any) {
            this.log(`最终解析失败: ${e.message}`);
            return null;
        }
    }

    /**
     * 公共解析方法，执行完整的修复和解析管道。
     * @param rawOutput - 来自 LLM 的原始字符串输出。
     * @returns ParseResult<T> 对象，包含数据、错误和日志。
     */
    public parse(rawOutput: string): ParseResult<T> {
        this.logs = []; // 重置日志
        this.log(`开始解析，原始输入长度: ${rawOutput.length}`);
        this.log("原始输入: " + rawOutput.substring(0, 200) + (rawOutput.length > 200 ? "..." : ""));

        // 执行新的、更健壮的修复管道
        let processedString = this._stripWrapperText(rawOutput);
        processedString = this._findJsonBoundaryAndTrim(processedString); // 新增的智能裁剪阶段
        processedString = this._fixDanglingParts(processedString);
        processedString = this._fixUnclosedStructures(processedString);
        processedString = this._runStandardRepair(processedString);

        const result = this._finalParse(processedString);

        if (result) {
            this.log("解析流程成功完成。");
            return {
                data: result,
                error: null,
                logs: this.logs,
            };
        } else {
            // 如果所有步骤都失败了，再尝试一次最大努力的修复：
            // 直接对原始提取的字符串应用 jsonrepair
            this.log("标准流程失败，尝试对初次提取的字符串进行最大努力修复。");
            const stripped = this._stripWrapperText(rawOutput); // 使用新的剥离方法
            try {
                const repairedOnOriginal = jsonrepair(stripped);
                const finalAttempt = JSON.parse(repairedOnOriginal) as T;
                this.log("最大努力修复成功！");
                return {
                    data: finalAttempt,
                    error: null,
                    logs: this.logs,
                };
            } catch (e: any) {
                this.log(`最大努力修复也失败了: ${e.message}`);
                return {
                    data: null,
                    error: "经过所有修复尝试后，JSON 仍然无法解析。",
                    logs: this.logs,
                };
            }
        }
    }
}
