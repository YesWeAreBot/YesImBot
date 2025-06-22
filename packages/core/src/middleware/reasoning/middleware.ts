import { Context } from "koishi";
import { UserMessagePart } from "xsai";
import { AgentResponse, DataManager, PromptBuilder } from "../../services";
import { LLMRequestError } from "../../shared";
import { BaseMiddleware, MiddlewareContext } from "../base";
import { ReasoningConfig } from "./config";
import { LLMProcessor } from "./llm-processor";
import { LLMOutput, LLMResponseParser } from "./llm-response-parser";
import { ToolCoordinator, ToolExecutionResult } from "./tool-coordinator";

/**
 * 统一的推理引擎中间件
 *
 * 职责：
 * 1. 编排整个推理流程（心跳循环）。
 * 2. 委托 PromptBuilder 构建提示。
 * 3. 委托 LLMProcessor 与 LLM 交互。
 * 4. 委托 LLMResponseParser 解析响应。
 * 5. 委托 ToolCoordinator 执行工具。
 * 6. 委托 DataManager 持久化结果。
 * 7. 管理最终的 RunLog。
 */
export class ReasoningMiddleware extends BaseMiddleware<ReasoningConfig> {
    private readonly dataManager: DataManager;
    private readonly promptBuilder: PromptBuilder;

    // 新的、职责单一的服务模块
    private readonly llmProcessor: LLMProcessor;
    private readonly llmResponseParser: LLMResponseParser;
    private readonly toolCoordinator: ToolCoordinator;

    constructor(ctx: Context, config: ReasoningConfig) {
        super("reasoning", ctx, config);

        // 依赖注入服务
        this.dataManager = this.ctx.get("yesimbot.data");
        const modelService = this.ctx.get("yesimbot.model");
        this.promptBuilder = this.ctx.get("yesimbot.promptBuilder");
        const toolService = this.ctx.get("yesimbot.tool");

        if (!this.dataManager || !modelService || !this.promptBuilder || !toolService) {
            throw new Error("ReasoningMiddleware 初始化失败：缺少必要的服务。");
        }

        // 初始化功能模块
        this.llmProcessor = new LLMProcessor(modelService, this.config.Processing, this.logger);
        this.llmResponseParser = new LLMResponseParser(this.logger);
        this.toolCoordinator = new ToolCoordinator(toolService, this.logger);
    }

    async execute(ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> {
        const startTime = Date.now();
        this.logger.info("推理中间件启动...");

        const runLog: AgentResponse[] = [];
        let heartbeatCount = 0;
        let requestHeartbeat = true;

        try {
            while (requestHeartbeat && heartbeatCount < this.config.MaxHeartbeat) {
                heartbeatCount++;
                this.logger.info(`开始推理循环 #${heartbeatCount}/${this.config.MaxHeartbeat}`);

                // 1. 构建 Prompt
                const prompts = await this.buildPrompts(ctx);

                // 2. 调用 LLM (委托给 LLMProcessor)
                const llmResult = await this.llmProcessor.generateResponse(prompts);

                // 3. 解析响应 (委托给 LLMResponseParser)
                const parsedOutput = this.llmResponseParser.parse(llmResult.text);
                if (!parsedOutput) {
                    this.logger.warn("无法解析LLM响应，终止推理循环。");
                    break;
                }

                // 记录思考过程
                this.logThoughts(parsedOutput.thoughts);

                // 4. 执行工具 (委托给 ToolCoordinator)
                const toolResults = await this.toolCoordinator.executeActions(parsedOutput.actions, ctx);

                // 5. 整合并记录本轮结果
                const agentResponse = this.createAgentResponse(parsedOutput, toolResults);
                runLog.push(agentResponse);
                await this.saveAgentResponse(ctx, agentResponse);

                // 6. 决定是否继续循环
                requestHeartbeat = parsedOutput.request_heartbeat;
                if (!requestHeartbeat) {
                    this.logger.info("LLM请求结束心跳，推理循环正常终止。");
                }
            }

            if (heartbeatCount >= this.config.MaxHeartbeat) {
                this.logger.warn(`达到最大心跳次数 (${this.config.MaxHeartbeat})，强制终止推理循环。`);
            }
        } catch (error) {
            this.logger.error("推理循环中发生未捕获的错误:", error);
            // 可以根据错误类型进行更细致的处理
            throw error;
        } finally {
            ctx.agentResponses = runLog; // 将完整的运行记录附加到上下文
            const duration = Date.now() - startTime;
            this.logger.info(`推理中间件执行完毕，耗时 ${duration}ms。`);
            this.dataManager.endTurn(ctx.currentTurnId);
        }

        await next();
    }

    /**
     * 记录思考过程
     */
    private logThoughts(thoughts: LLMOutput["thoughts"]): void {
        this.logger.info("=== AI思考过程 ===");
        this.logger.info(`观察: ${thoughts.observe}`);
        this.logger.info(`分析推理: ${thoughts.analyze_infer}`);
        this.logger.info(`计划: ${thoughts.plan}`);
        this.logger.info("================");
    }

    private async buildPrompts(ctx: MiddlewareContext): Promise<{ system: string; user: string | UserMessagePart[] }> {
        try {
            return await this.promptBuilder.build(ctx);
        } catch (error) {
            this.logger.error("构建提示词失败:", error);
            throw new LLMRequestError("构建提示词时出错", null, null, null, error as Error);
        }
    }

    private createAgentResponse(output: LLMOutput, toolResults: ToolExecutionResult[]): AgentResponse {
        return {
            thoughts: {
                obverse: output.thoughts.observe,
                analyze_infer: output.thoughts.analyze_infer,
                plan: output.thoughts.plan,
            },
            actions: output.actions,
            observations: toolResults.map((result) => ({
                function: result.function,
                result: {
                    status: result.status,
                    result: result.result,
                    error: result.error,
                },
            })),
        };
    }

    private async saveAgentResponse(ctx: MiddlewareContext, response: AgentResponse): Promise<void> {
        if (!ctx.currentTurnId) return;
        try {
            await this.dataManager.addAgentResponse(ctx.currentTurnId, response);
            this.logger.debug("本轮Agent响应已成功保存至数据库。");
        } catch (error) {
            this.logger.error("保存Agent响应至数据库失败:", error);
        }
    }
}
