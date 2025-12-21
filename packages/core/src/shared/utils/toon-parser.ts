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
                    this.log(`行 ${i + 1}: 警告 - action 名称为空`);
                }
                currentAction = { name: actionName, params: {} };
                result.actions.push(currentAction);
                inParams = false;
                this.log(`行 ${i + 1}: 解析到 action: ${actionName}`);
                continue;
            }

            // 处理 params 标记
            if (trimmed.startsWith("params:")) {
                inParams = true;
                this.log(`行 ${i + 1}: 进入 params 块`);
                continue;
            }

            // 在 params 块内解析键值对
            if (inParams && currentAction) {
                const colonIndex = trimmed.indexOf(":");
                if (colonIndex !== -1) {
                    const key = trimmed.substring(0, colonIndex).trim();
                    const value = trimmed.substring(colonIndex + 1).trim();
                    currentAction.params[key] = value;
                    this.log(`行 ${i + 1}: 解析参数 ${key}`);
                } else {
                    this.log(`行 ${i + 1}: 警告 - params 块中的行格式不正确，缺少冒号`);
                }
            } else if (trimmed.includes(":") && !trimmed.startsWith("+") && !trimmed.startsWith("-")) {
                this.log(`行 ${i + 1}: 忽略未在 params 块内的键值对或未知行: ${trimmed}`);
            }
        }

        // 验证结构
        if (!Array.isArray(result.actions)) {
            this.log("解析错误: actions 不是数组");
            return { data: null, error: "无效的 Toon 结构: actions 缺失或不是数组", logs: this.logs };
        }

        for (const action of result.actions) {
            if (!action.name) {
                this.log("解析错误: 存在缺失名称的 action");
                return { data: null, error: "无效的 Toon 结构: action 缺失名称", logs: this.logs };
            }
        }

        this.log("Toon 解析成功完成");
        return { data: result as T, error: null, logs: this.logs };
    }
}
