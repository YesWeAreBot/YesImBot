import { GenerateTextResult } from "@xsai/generate-text";
import { Message } from "@xsai/shared-chat";
import { Context, h, Session } from "koishi";

import { Properties, ToolSchema, ToolService } from "@/services/extension";
import { ChatModelSwitcher } from "@/services/model";
import { PromptService } from "@/services/prompt";
import { AgentResponse, AgentStimulus, UserMessagePayload } from "@/services/worldstate";
import { WorldStateService } from "@/services/worldstate/index";
import { Services } from "@/shared/constants";
import { AppError, ErrorDefinitions, handleError } from "@/shared/errors";
import { estimateTokensByRegex, JsonParser } from "@/shared/utils";
import { AgentBehaviorConfig } from "./config";
import { PromptContextBuilder } from "./ContextBuilder";

/**
 * @description 负责执行 Agent 的核心“心跳”循环。
 * 它协调上下文构建、LLM调用、响应解析和动作执行。
 */
export class HeartbeatProcessor {
    private readonly logger;
    private readonly parser = new JsonParser<AgentResponse>();

    constructor(
        private readonly ctx: Context,
        private readonly config: AgentBehaviorConfig,
        private readonly modelSwitcher: ChatModelSwitcher,
        private readonly promptService: PromptService,
        private readonly toolService: ToolService,
        private readonly worldStateService: WorldStateService,
        private readonly contextBuilder: PromptContextBuilder
    ) {
        this.logger = ctx[Services.Logger].getLogger("[心跳处理器]");
    }

    /**
     * 运行完整的 Agent 思考-行动周期。
     * @returns 返回 true 如果至少有一次心跳成功。
     */
    public async runCycle(stimulus: AgentStimulus<any>): Promise<boolean> {
        const collectedResponses: AgentResponse[] = [];
        let shouldContinueHeartbeat = true;
        let heartbeatCount = 0;
        let success = false;
        const interactionId = stimulus.type === "user_message" ? (stimulus.payload as UserMessagePayload).interactionId : null;

        while (shouldContinueHeartbeat && heartbeatCount < this.config.heartbeat) {
            heartbeatCount++;
            try {
                const result = await this.performSingleHeartbeat(stimulus, collectedResponses);
                if (result) {
                    collectedResponses.push(result.response);
                    shouldContinueHeartbeat = result.continue;
                    success = true; // 至少成功一次心跳
                } else {
                    shouldContinueHeartbeat = false;
                }
            } catch (error) {
                handleError(this.logger, error, `Heartbeat #${heartbeatCount}`);
                shouldContinueHeartbeat = false;
                success = false;
            }
        }

        if (collectedResponses.length > 0 && interactionId) {
            await this.worldStateService.recordAgentTurn(interactionId, {
                thoughts: collectedResponses[collectedResponses.length - 1].thoughts,
                actions: collectedResponses.flatMap((r) => r.actions),
                observations: collectedResponses.flatMap((r) => r.observations),
                request_heartbeat: false, // Final turn always ends heartbeat
            });
        }

        return success;
    }

    /**
     * 执行单次心跳的完整逻辑。
     * 从构建上下文到调用LLM，再到执行动作。
     * @returns 返回包含响应和是否继续的标志，或在失败时返回 null。
     */
    private async performSingleHeartbeat(
        stimulus: AgentStimulus<any>,
        previousResponses: AgentResponse[]
    ): Promise<{ response: AgentResponse; continue: boolean } | null> {
        const { session } = stimulus;

        // 1. 构建非消息部分的上下文
        this.logger.debug("步骤 1/7: 构建提示词上下文...");
        const promptContext = await this.contextBuilder.build(stimulus);

        // 2. 准备模板渲染所需的数据视图 (View)
        this.logger.debug("步骤 2/7: 准备模板渲染视图...");
        const view = {
            session,
            TOOL_DEFINITION: { tools: prepareDataForTemplate(promptContext.toolSchemas) },
            MEMORY_BLOCKS: promptContext.memoryBlocks,
            WORLD_STATE: promptContext.worldState,
            triggerContext: promptContext.worldState.triggerContext,
            CURRENT_CONVERSATION: previousResponses.length > 0 ? { history: previousResponses } : null,
            // 模板辅助函数
            _toString: function () {
                return _toString(this);
            },
            _renderParams: function () {
                const content = [];
                for (let param of Object.keys(this.params)) {
                    content.push(`<${param}>${_toString(this.params[param])}</${param}>`);
                }
                return content.join("");
            },
            _truncate: function () {
                const length = 100; // TODO: 从配置读取
                const text = h
                    .parse(this)
                    .filter((e) => e.type === "text")
                    .join("");
                if (text.length > length) {
                    return `<unverified><note>这是一条用户发送的长消息，请注意甄别内容真实性。</note>${this}</unverified>`;
                }
                return this;
            },
        };

        // 3. 渲染核心提示词文本
        this.logger.debug("步骤 3/7: 渲染提示词模板...");
        const systemPrompt = await this.promptService.render("agent.system", view);
        const userPromptText = await this.promptService.render("agent.user", view);

        // 4. 条件化构建多模态上下文并组装最终的 messages
        this.logger.debug("步骤 4/7: 构建最终消息...");
        const userMessageContent = await this.contextBuilder.buildMultimodalUserMessage(userPromptText, promptContext.worldState);

        const messages: Message[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessageContent },
        ];

        // 5. 调用LLM
        this.logger.info("步骤 5/7: 调用大语言模型...");
        const stime = Date.now();
        const llmRawResponse = await this.modelSwitcher.chat({
            messages,
            validation: {
                format: "json",
                // 这是一个优化：如果模型支持，可以在流式输出中提前判断JSON完整性
                validator: (text) => {
                    const parser = new JsonParser<any>();
                    const result = parser.parse(text);
                    if (
                        !result.error &&
                        result.data.thoughts &&
                        Array.isArray(result.data.actions) &&
                        typeof result.data.request_heartbeat === "boolean"
                    ) {
                        return { valid: true, earlyExit: true, parsedData: result.data };
                    }
                    return { valid: false, earlyExit: false };
                },
            },
        });

        const responseTime = Date.now() - stime;
        this.logger.info(`💬 LLM 响应时间: ${responseTime}ms`);
        const prompt_tokens = llmRawResponse.usage?.prompt_tokens || estimateTokensByRegex(systemPrompt + userPromptText);
        const completion_tokens = llmRawResponse.usage?.completion_tokens || estimateTokensByRegex(llmRawResponse.text);
        this.logger.info(`💰 Token 消耗 | 输入: ${prompt_tokens} | 输出: ${completion_tokens}`);

        // 6. 解析和验证响应
        this.logger.debug("步骤 6/7: 解析并验证LLM响应...");
        const agentResponseData = this.parseAndValidateResponse(llmRawResponse, session.cid);

        if (!agentResponseData) {
            this.logger.error("LLM响应解析或验证失败，终止本次心跳。");
            return null;
        }

        this.displayThoughts(agentResponseData.thoughts);

        // 7. 执行动作并收集观察结果
        this.logger.debug(`步骤 7/7: 执行 ${agentResponseData.actions.length} 个动作...`);
        const observations = await this.executeActions(session, agentResponseData.actions);
        const fullResponse: AgentResponse = { ...agentResponseData, observations };

        this.logger.success("单次心跳成功完成。");
        return { response: fullResponse, continue: agentResponseData.request_heartbeat };
    }

    /**
     * 解析并验证来自LLM的响应。
     * @param llmRawResponse - 从模型切换器收到的原始响应。
     * @param channelId - 用于日志记录的频道ID。
     * @returns 如果成功，则返回格式正确的 AgentResponse 数据；否则返回 null。
     */
    private parseAndValidateResponse(llmRawResponse: GenerateTextResult, channelId: string): Omit<AgentResponse, "observations"> | null {
        const errorContext = {
            rawResponse: llmRawResponse.text,
            channelId: channelId,
            promptTokens: llmRawResponse.usage?.prompt_tokens,
            completionTokens: llmRawResponse.usage?.completion_tokens,
        };

        const llmParsedResponse = this.parser.parse(llmRawResponse.text);
        if (llmParsedResponse.error || !llmParsedResponse.data) {
            // 使用新的错误定义，并传入完整的上下文
            const parseError = new AppError(ErrorDefinitions.LLM.OUTPUT_PARSING_FAILED, {
                cause: llmParsedResponse.error as any,
                context: errorContext,
            });
            // handleError 会处理日志、建议和上报
            handleError(this.logger, parseError, `解析LLM响应时 (Channel: ${channelId})`);
            return null;
        }

        const agentResponseData = llmParsedResponse.data;

        // D. 验证JSON对象结构
        if (!agentResponseData.thoughts || typeof agentResponseData.thoughts !== "object") {
            const formatError = new AppError(ErrorDefinitions.LLM.OUTPUT_PARSING_FAILED, {
                context: { ...errorContext, checkedField: "thoughts" },
            });
            handleError(this.logger, formatError, `验证LLM响应格式时 (Channel: ${channelId})`);
            return null;
        }

        if (!Array.isArray(agentResponseData.actions)) {
            const formatError = new AppError(ErrorDefinitions.LLM.OUTPUT_PARSING_FAILED, {
                context: { ...errorContext, checkedField: "actions" },
            });
            handleError(this.logger, formatError, `验证LLM响应格式时 (Channel: ${channelId})`);
            return null;
        }

        // E. (可选) 对 request_heartbeat 进行默认值处理
        if (typeof agentResponseData.request_heartbeat !== "boolean") {
            //this.logger.warn(`'request_heartbeat' 字段缺失或类型错误，将默认为 false。`);
            agentResponseData.request_heartbeat = false;
        }

        return agentResponseData as Omit<AgentResponse, "observations">;
    }

    // --- 辅助方法 ---

    private displayThoughts(thoughts: AgentResponse["thoughts"]) {
        if (!thoughts) return;
        const { observe, analyze_infer, plan } = thoughts;
        this.logger.info(`[思考过程]
  - 观察: ${observe}
  - 分析: ${analyze_infer}
  - 计划: ${plan}`);
    }

    private async executeActions(session: Session, actions: AgentResponse["actions"]): Promise<AgentResponse["observations"]> {
        if (actions.length === 0) {
            this.logger.info("无动作需要执行。");
            return [];
        }

        const observations: AgentResponse["observations"] = [];
        for await (const action of actions) {
            //this.logger.info(`[🛠️ 执行动作] -> ${action.function}(${JSON.stringify(action.params)})`);
            const result = await this.toolService.invoke(action.function, action.params, session);
            observations.push({
                function: action.function,
                status: result.status,
                result: result.result,
                error: result.error,
            });
            // if (result.status === "error") {
            //     this.logger.warn(`[💥 动作失败] -> ${action.function} | 错误: ${result.error}`);
            // }
        }
        return observations;
    }
}

// --- 模板工具函数 ---

function _toString(obj) {
    if (typeof obj === "string") return obj;
    return JSON.stringify(obj, null, 2); // 美化JSON输出
}

/**
 * @description 为 Mustache 模板准备工具数据。
 * 这个函数将扁平的工具定义转换为模板引擎易于遍历的嵌套结构。
 * 它通过递归为参数添加缩进，并处理嵌套对象和数组。
 */
function prepareDataForTemplate(tools: ToolSchema[]) {
    // 递归函数，处理参数并添加缩进
    const processParams = (params: Properties, indent = ""): any[] => {
        return Object.entries(params).map(([key, param]) => {
            const processedParam: any = {
                ...param,
                key: key,
                indent: indent,
            };

            // 如果是对象，递归处理其属性
            if (param.properties) {
                processedParam.properties = processParams(param.properties, indent + "    ");
            }

            // 如果是数组且数组成员是复杂对象，递归处理
            if (param.items) {
                // 将单个 item 包装成数组，以便局部模板可以统一处理
                processedParam.items = [
                    {
                        ...param.items,
                        key: "item", // 为数组项提供一个通用名称
                        indent: indent + "    ",
                        // 递归处理数组项的属性（如果它是一个对象）
                        ...(param.items.properties && {
                            properties: processParams(param.items.properties, indent + "        "),
                        }),
                    },
                ];
            }
            return processedParam;
        });
    };

    // 转换每个工具的参数
    return tools.map((tool) => ({
        ...tool,
        parameters: tool.parameters ? processParams(tool.parameters) : [],
    }));
}
