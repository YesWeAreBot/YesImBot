import { Logger } from "koishi";
import { MiddlewareContext } from "../../middleware/base";
import { ToolService } from "../../services";

interface FunctionTool {
    function: string;
    params: Record<string, unknown>;
}

export interface ToolExecutionResult {
    status: "success" | "failed";
    result?: any;
    error?: string;
    function: string;
}

export class ToolCoordinator {
    constructor(private readonly toolService: ToolService, private readonly logger: Logger) {}

    /**
     * 按顺序执行一系列工具调用
     * @param actions 要执行的工具列表
     * @param ctx 中间件上下文
     * @returns 每个工具的执行结果数组
     */
    public async executeActions(actions: FunctionTool[], ctx: MiddlewareContext): Promise<ToolExecutionResult[]> {
        const results: ToolExecutionResult[] = [];

        for (const action of actions) {
            this.logger.info(`准备执行工具: ${action.function}`);
            let result: ToolExecutionResult;

            try {
                const tool = this.toolService.getTool(action.function);
                if (!tool) {
                    throw new Error(`工具 '${action.function}' 未找到`);
                }

                // 执行工具
                const toolResult = await tool.execute(action.params, {
                    koishiContext: ctx.koishiContext,
                    koishiSession: ctx.koishiSession,
                    platform: ctx._platform,
                });

                result = {
                    status: toolResult.status === "success" ? "success" : "failed",
                    result: toolResult.result,
                    error: toolResult.error,
                    function: action.function,
                };
                this.logger.info(`工具 ${action.function} 执行完成，状态: ${result.status}`);
            } catch (error) {
                this.logger.error(`工具 ${action.function} 执行时发生严重错误:`, error.message);
                if (error instanceof Error) {
                    this.logger.error(error.stack);
                }
                result = {
                    status: "failed",
                    error: (error as Error).message,
                    function: action.function,
                };
            }
            results.push(result);
        }

        if ((results.length = 0)) {
            this.logger.warn("没有工具需要执行");
        }

        return results;
    }
}
