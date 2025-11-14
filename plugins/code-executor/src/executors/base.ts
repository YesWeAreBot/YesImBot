import { ToolCallResult, ToolDefinition, ToolError } from "koishi-plugin-yesimbot/services/plugin";

/**
 * 代表一个标准化的执行错误结构。
 * 旨在为上层应用（特别是LLM）提供清晰、可操作的错误信息。
 */
export interface ExecutionError extends ToolError {
    /**
     * 错误类型/名称，例如 'SyntaxError', 'EnvironmentError', 'TimeoutError'。
     */
    name: string;
    /**
     * 具体的错误信息，描述发生了什么。
     */
    message: string;
    /**
     * 可选的堆栈跟踪信息，用于调试。
     */
    stack?: string;
    /**
     * 针对此错误的修复建议，主要提供给LLM用于自我纠正。
     */
    suggestion?: string;
}

/**
 * 代表一个执行后产生的文件或可视化产物。
 */
export interface ExecutionArtifact {
    /**
     * 资源的唯一ID，由 `ResourceManager.create` 返回。
     * 这是与资源交互的唯一标识符。
     */
    assetId: string;

    /**
     * AI请求创建时使用的原始文件名或描述。
     * 例如 "monthly_sales_chart.png"。这对于向用户展示非常重要。
     */
    fileName: string;
}

/**
 * 标准化的代码执行成功时的返回结果。
 */
export interface CodeExecutionSuccessResult {
    /** 标准输出流的内容 */
    stdout: string;
    /** 标准错误流的内容 (即使执行成功，也可能有警告信息) */
    stderr: string;
    /** 执行过程中产生的结构化产物 */
    artifacts?: ExecutionArtifact[];
}

/**
 * 标准化的代码执行结果接口，继承自ToolCallResult。
 * 它封装了成功和失败两种状态。
 */
export type CodeExecutionResult = ToolCallResult<CodeExecutionSuccessResult>;

/**
 * 所有代码执行引擎必须实现的接口。
 * 定义了一个代码执行器的标准契约。
 */
export interface CodeExecutor {
    /**
     * 引擎的唯一类型标识符，例如 'javascript', 'python'。
     */
    readonly type: string;

    /**
     * 执行给定的代码。
     * @param code 要执行的代码字符串。
     * @returns 返回一个包含执行状态、输出和错误的标准化结果。
     */
    execute(code: string): Promise<CodeExecutionResult>;

    /**
     * 生成并返回该执行器对应的 Koishi 工具定义。
     * @returns 工具定义对象，用于集成到LLM的工具集中。
     */
    getToolDefinition(): ToolDefinition;
}
