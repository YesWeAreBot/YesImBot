import type { ParseResult, ParserOptions } from "./json-parser";

const defaultLogger = {
    info: (message: string) => console.log(`[INFO] ${message}`),
    warn: (message: string) => console.warn(`[WARN] ${message}`),
    error: (message: string) => console.error(`[ERROR] ${message}`),
};

export class ToonParser<T> {
    private readonly options: Required<ParserOptions>;
    private logs: string[] = [];

    constructor(options: ParserOptions = {}) {
        this.options = {
            debug: options.debug ?? false,
            logger: (options.logger as any) ?? defaultLogger,
        };
    }

    private log(message: string): void {
        if (this.options.debug) {
            this.options.logger.info(message);
        }
        this.logs.push(message);
    }

    public parse(rawOutput: string): ParseResult<T> {
        this.logs = [];
        const errors: string[] = [];
        this.log(`开始 Toon 解析，原始输入长度: ${rawOutput.length}`);

        let processedString = rawOutput.trim();

        // 提取 toon 代码块
        const codeBlockStartIndex = processedString.indexOf("```toon");
        if (codeBlockStartIndex !== -1) {
            this.log("检测到 toon 代码块");
            const lastCodeBlockIndex = processedString.lastIndexOf("```");
            processedString = lastCodeBlockIndex > codeBlockStartIndex
                ? processedString.substring(codeBlockStartIndex + 7, lastCodeBlockIndex).trim()
                : processedString.substring(codeBlockStartIndex + 7).trim();
        } else if (processedString.includes("```")) {
            this.log("未检测到 toon 标识，尝试提取通用代码块");
            const firstBlock = processedString.indexOf("```");
            const lastBlock = processedString.lastIndexOf("```");
            if (lastBlock > firstBlock) {
                const content = processedString.substring(firstBlock + 3, lastBlock).trim();
                const firstNewline = content.indexOf("\n");
                if (firstNewline !== -1) {
                    const firstLine = content.substring(0, firstNewline).trim();
                    if (!firstLine.includes(":") && !firstLine.startsWith("+") && !firstLine.startsWith("-")) {
                        this.log(`移除了可能的语言标识: "${firstLine}"`);
                        processedString = content.substring(firstNewline + 1).trim();
                    } else {
                        processedString = content;
                    }
                } else {
                    processedString = content;
                }
            }
        }

        if (!processedString) {
            this.log("解析失败: 提取出的内容为空");
            return { data: null, error: "提取出的内容为空", logs: this.logs };
        }

        this.log(`待解析字符串长度: ${processedString.length}`);

        const lines = processedString.split("\n");
        const result: any = { actions: [] };
        let currentAction: any = null;
        let inParams = false;
        let lastParamKey: string | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed) continue;

            // 处理 thoughts
            if (trimmed.startsWith("+ thoughts:")) {
                result.thoughts = trimmed.substring(11).trim();
                this.log(`行 ${i + 1}: 解析到 thoughts`);
                continue;
            }

            // 处理 actions 列表
            if (trimmed.startsWith("+ actions:")) {
                if (trimmed.includes("[]")) {
                    result.actions = [];
                }
                this.log(`行 ${i + 1}: 解析到 actions 列表标记`);
                continue;
            }

            // 处理具体的 action
            if (trimmed.startsWith("- name:")) {
                const actionName = trimmed.substring(7).trim();
                if (!actionName) {
                    const errMsg = `行 ${i + 1}: 错误 - action 名称为空`;
                    this.log(errMsg);
                    errors.push(errMsg);
                }
                currentAction = { name: actionName, params: {} };
                result.actions.push(currentAction);
                inParams = false;
                lastParamKey = null;
                this.log(`行 ${i + 1}: 解析到 action: ${actionName}`);
                continue;
            }

            // 处理 params 标记
            if (trimmed.startsWith("params:") || trimmed.startsWith("parameters:")) {
                inParams = true;
                lastParamKey = null;
                this.log(`行 ${i + 1}: 进入 params 块`);
                continue;
            }

            // 自动识别参数：如果在 action 之后遇到键值对且不带 +/-，自动开启 params 模式
            if (currentAction && !inParams && trimmed.includes(":") && !trimmed.startsWith("+") && !trimmed.startsWith("-")) {
                inParams = true;
                this.log(`行 ${i + 1}: 自动开启参数解析模式`);
            }

            // 在 params 模式下解析
            if (inParams && currentAction) {
                const colonIndex = trimmed.indexOf(":");
                if (colonIndex !== -1) {
                    const key = trimmed.substring(0, colonIndex).trim();
                    const value = trimmed.substring(colonIndex + 1).trim();
                    currentAction.params[key] = value;
                    lastParamKey = key;
                    this.log(`行 ${i + 1}: 解析参数 ${key}`);
                } else if (lastParamKey) {
                    // 没有冒号且之前已有参数，视为多行内容的后续
                    currentAction.params[lastParamKey] += `\n${trimmed}`;
                    this.log(`行 ${i + 1}: 追加内容到参数 ${lastParamKey}`);
                } else {
                    const errMsg = `行 ${i + 1}: 警告 - 参数块中的行格式不正确且无前导键，忽略: ${trimmed}`;
                    this.log(errMsg);
                }
            } else if (trimmed.includes(":") && !trimmed.startsWith("+") && !trimmed.startsWith("-")) {
                this.log(`行 ${i + 1}: 忽略未在 action 内的键值对: ${trimmed}`);
            }
        }

        // 验证结构
        if (!Array.isArray(result.actions)) {
            const errMsg = "无效的 Toon 结构: actions 缺失或不是数组";
            this.log(`解析错误: ${errMsg}`);
            return { data: null, error: errMsg, logs: this.logs };
        }

        for (const action of result.actions) {
            if (!action.name) {
                const errMsg = "无效的 Toon 结构: action 缺失名称";
                this.log(`解析错误: ${errMsg}`);
                return { data: null, error: errMsg, logs: this.logs };
            }
        }

        if (errors.length > 0) {
            this.log(`解析过程中发现 ${errors.length} 个错误`);
            return { data: result as T, error: errors.join("; "), logs: this.logs };
        }

        this.log("Toon 解析成功完成");
        return { data: result as T, error: null, logs: this.logs };
    }

    /**
     * 解析简单的 Toon/YAML 风格键值对
     */
    public static parseSimple(text: string): Record<string, any> {
        const result: Record<string, any> = {};
        const lines = text.split('\n');
        for (const line of lines) {
            const colonIndex = line.indexOf(':');
            if (colonIndex !== -1) {
                const key = line.substring(0, colonIndex).trim();
                let value = line.substring(colonIndex + 1).trim();
                // 尝试解析 JSON 值（针对对象或数组）
                if (value.startsWith('{') || value.startsWith('[')) {
                    try {
                        value = JSON.parse(value);
                    } catch {}
                }
                result[key] = value;
            }
        }
        return result;
    }

    /**
     * 将对象转换为 Toon 格式字符串
     */
    public static stringify(data: any, indent: string = "  ", includeHeader: boolean = true): string {
        if (!data)
            return "";
        
        // 如果是字符串，直接返回
        if (typeof data === 'string') return data;

        const lines: string[] = [];

        // 检查是否是标准的 Agent 输出结构 (thoughts 或 actions)
        if (data.thoughts || Array.isArray(data.actions)) {
            if (includeHeader && data.thoughts) {
                lines.push(`+ thoughts: ${data.thoughts}`);
            }

            if (Array.isArray(data.actions)) {
                if (data.actions.length === 0) {
                    if (includeHeader)
                        lines.push("+ actions: []");
                } else {
                    if (includeHeader)
                        lines.push("+ actions:");
                    for (const action of data.actions) {
                        lines.push(`${indent}- name: ${action.name}`);
                        if (action.params && Object.keys(action.params).length > 0) {
                            lines.push(`${indent}  params:`);
                            for (const [key, value] of Object.entries(action.params)) {
                                lines.push(`${indent}    ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
                            }
                        }
                    }
                }
            }
        } else {
            // 通用对象转换
            for (const [key, value] of Object.entries(data)) {
                lines.push(`${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
            }
        }

        return lines.join("\n");
    }

    /**
     * 将函数定义转换为 Toon 格式
     */
    public static formatFunction(func: any, indent: string = "  "): string {
        const lines: string[] = [];
        lines.push(`${indent}- name: ${func.name}`);
        if (func.description) {
            lines.push(`${indent}  description: ${func.description}`);
        }
        if (func.parameters && func.parameters.properties) {
            lines.push(`${indent}  params:`);
            for (const [name, prop] of Object.entries(func.parameters.properties as any)) {
                const p = prop as any;
                lines.push(`${indent}    ${name}: ${p.description || p.type || ""}`);
            }
        }
        return lines.join("\n");
    }
}
