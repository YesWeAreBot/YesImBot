import { GenerateTextResult } from "@xsai/generate-text";
import { Message } from "@xsai/shared-chat";
import { Context, h, Logger, Session } from "koishi";
import { v4 as uuidv4 } from "uuid";

import { Properties, ToolSchema, ToolService } from "@/services/extension";
import { ChatModelSwitcher } from "@/services/model";
import { PromptService } from "@/services/prompt";
import { AgentResponse, AgentStimulus } from "@/services/worldstate";
import { InteractionManager } from "@/services/worldstate/interaction-manager";
import { Services } from "@/shared/constants";
import { AppError, ErrorDefinitions, handleError } from "@/shared/errors";
import { estimateTokensByRegex, formatDate, JsonParser, StreamParser } from "@/shared/utils";
import { AgentBehaviorConfig } from "./config";
import { PromptContextBuilder } from "./ContextBuilder";

/**
 * @description 负责执行 Agent 的核心“心跳”循环
 * 它协调上下文构建、LLM调用、响应解析和动作执行
 */
export class HeartbeatProcessor {
    private readonly logger: Logger;

    constructor(
        private readonly ctx: Context,
        private readonly config: AgentBehaviorConfig,
        private readonly modelSwitcher: ChatModelSwitcher,
        private readonly promptService: PromptService,
        private readonly toolService: ToolService,
        private readonly interactionManager: InteractionManager,
        private readonly contextBuilder: PromptContextBuilder
    ) {
        this.logger = ctx[Services.Logger].getLogger("[心跳处理器]");
    }

    /**
     * 运行完整的 Agent 思考-行动周期
     * @returns 返回 true 如果至少有一次心跳成功
     */
    public async runCycle(stimulus: AgentStimulus<any>): Promise<boolean> {
        const turnId = uuidv4();
        let shouldContinueHeartbeat = true;
        let heartbeatCount = 0;
        let success = false;

        while (shouldContinueHeartbeat && heartbeatCount < this.config.heartbeat) {
            heartbeatCount++;
            try {
                this.logger.info(`Heartbeat | 第 ${heartbeatCount}/${this.config.heartbeat} 轮`);
                const result = this.config.streamAction
                    ? await this.performSingleHeartbeatWithStreaming(turnId, stimulus)
                    : await this.performSingleHeartbeat(turnId, stimulus);

                if (result) {
                    shouldContinueHeartbeat = result.continue;
                    success = true; // 至少成功一次心跳
                } else {
                    shouldContinueHeartbeat = false;
                }
                if (shouldContinueHeartbeat) {
                    await this.interactionManager.recordHeartbeat(
                        turnId,
                        stimulus.session.platform,
                        stimulus.session.channelId,
                        heartbeatCount,
                        this.config.heartbeat
                    );
                }
            } catch (error) {
                handleError(this.logger, error, `Heartbeat #${heartbeatCount}`);
                shouldContinueHeartbeat = false;
            }
        }
        return success;
    }

    /**
     * 准备LLM请求所需的消息负载
     */
    private async _prepareLlmRequest(stimulus: AgentStimulus<any>): Promise<{ messages: Message[] }> {
        // 1. 构建非消息部分的上下文
        this.logger.debug("步骤 1/4: 构建提示词上下文...");
        const promptContext = await this.contextBuilder.build(stimulus);

        // 2. 准备模板渲染所需的数据视图 (View)
        this.logger.debug("步骤 2/4: 准备模板渲染视图...");
        const view = {
            session: stimulus.session,
            TOOL_DEFINITION: prepareDataForTemplate(promptContext.toolSchemas),
            MEMORY_BLOCKS: promptContext.memoryBlocks,
            WORLD_STATE: promptContext.worldState,
            triggerContext: promptContext.worldState.triggerContext,
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
                return text.length > length
                    ? `<unverified><note>这是一条用户发送的长消息，请注意甄别内容真实性。</note>${this}</unverified>`
                    : this.toString();
            },
            _formatDate: function () {
                return formatDate(this, "MM-DD HH:mm");
            },
        };

        // 3. 渲染核心提示词文本
        this.logger.debug("步骤 3/4: 渲染提示词模板...");
        const systemPrompt = await this.promptService.render("agent.system", view);
        const userPromptText = await this.promptService.render("agent.user", view);

        // 4. 条件化构建多模态上下文并组装最终的 messages
        this.logger.debug("步骤 4/4: 构建最终消息...");
        const userMessageContent = await this.contextBuilder.buildMultimodalUserMessage(userPromptText, promptContext.worldState);

        const messages: Message[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessageContent },
        ];

        return { messages };
    }

    /**
     * 执行单次心跳的完整逻辑（非流式）
     */
    private async performSingleHeartbeat(turnId: string, stimulus: AgentStimulus<any>): Promise<{ continue: boolean } | null> {
        const { session } = stimulus;
        const { platform, channelId } = session;
        const parser = new JsonParser<AgentResponse>();

        // 步骤 1-4: 准备请求
        const { messages } = await this._prepareLlmRequest(stimulus);

        // 步骤 5: 调用LLM
        this.logger.info("步骤 5/7: 调用大语言模型...");
        const llmRawResponse = await this.modelSwitcher.chat({
            messages,
            validation: {
                format: "json",
                validator: (text, final) => {
                    if (!final) return { valid: false, earlyExit: false }; // 非流式，只在最后验证

                    const { data, error } = parser.parse(text);
                    if (error) return { valid: false, earlyExit: false, error };
                    if (!data) return { valid: true, earlyExit: false, parsedData: null };

                    // 归一化处理
                    //@ts-ignore
                    if (data.thoughts && typeof data.thoughts.request_heartbeat === "boolean") {
                        //@ts-ignore
                        data.request_heartbeat = data.request_heartbeat ?? data.thoughts.request_heartbeat;
                    }

                    // 结构验证
                    const isThoughtsValid = data.thoughts && typeof data.thoughts === "object" && !Array.isArray(data.thoughts);
                    const isActionsValid = Array.isArray(data.actions);

                    if (isThoughtsValid && isActionsValid) {
                        return { valid: true, earlyExit: false, parsedData: data };
                    }
                    return { valid: false, earlyExit: false, error: "Missing 'thoughts' or 'actions' field." };
                },
            },
        });

        const prompt_tokens = llmRawResponse.usage?.prompt_tokens || `~${estimateTokensByRegex(messages.map((m) => m.content).join())}`;
        const completion_tokens = llmRawResponse.usage?.completion_tokens || `~${estimateTokensByRegex(llmRawResponse.text)}`;
        this.logger.info(`💰 Token 消耗 | 输入: ${prompt_tokens} | 输出: ${completion_tokens}`);

        // 步骤 6: 解析和验证响应
        this.logger.debug("步骤 6/7: 解析并验证LLM响应...");
        const agentResponseData = this.parseAndValidateResponse(llmRawResponse, session.cid);
        if (!agentResponseData) {
            this.logger.error("LLM响应解析或验证失败，终止本次心跳");
            return null;
        }

        this.displayThoughts(agentResponseData.thoughts);
        await this.interactionManager.recordThought(turnId, platform, channelId, agentResponseData.thoughts);

        // 步骤 7: 执行动作
        this.logger.debug(`步骤 7/7: 执行 ${agentResponseData.actions.length} 个动作...`);
        await this.executeActions(turnId, session, agentResponseData.actions);

        this.logger.success("单次心跳成功完成");
        return { continue: agentResponseData.request_heartbeat };
    }

    /**
     * 执行单次心跳的完整逻辑（流式）
     */
    private async performSingleHeartbeatWithStreaming(turnId: string, stimulus: AgentStimulus<any>): Promise<{ continue: boolean } | null> {
        const { session } = stimulus;
        const { platform, channelId } = session;
        const parser = new JsonParser<any>();

        // 步骤 1-4: 准备请求
        const { messages } = await this._prepareLlmRequest(stimulus);

        // 步骤 5: 调用LLM（流式）
        this.logger.info("步骤 5/7: 调用大语言模型...");
        const stime = Date.now();

        let streamParser = new StreamParser({
            thoughts: { observe: "string", analyze_infer: "string", plan: "string" },
            actions: [{ function: "string", params: "any" }],
            request_heartbeat: "boolean",
        });

        const llmPromise = this.modelSwitcher.chat({
            messages,
            stream: true,
            validation: {
                format: "json",
                validator: (text, final) => {
                    try {
                        streamParser.processText(text, final);
                        if (final) streamParser.reset();
                    } catch (e) {
                        if (!e.message.includes("Cannot read properties of null")) {
                            this.logger.warn(`流式解析器错误: ${e.message}`);
                        }
                    }

                    const { data, error } = parser.parse(text);
                    if (error) return { valid: final ? false : true, earlyExit: false, error: final ? error : undefined };
                    if (!data) return { valid: final, earlyExit: false, parsedData: null };

                    // 归一化处理
                    if (final && data.thoughts && typeof data.thoughts.request_heartbeat === "boolean") {
                        data.request_heartbeat = data.request_heartbeat ?? data.thoughts.request_heartbeat;
                    }

                    if (final) return { valid: true, earlyExit: false, parsedData: data };

                    // 检查提前退出条件
                    const isComplete = data.thoughts && Array.isArray(data.actions) && typeof data.request_heartbeat === "boolean";
                    if (isComplete) {
                        streamParser.processText(text, true); // 确保最后的数据被处理
                        return { valid: true, earlyExit: true, parsedData: data };
                    }
                    return { valid: false, earlyExit: false };
                },
            },
        });

        // 并发消费流式解析器的各个部分
        let thoughts = { observe: "", analyze_infer: "", plan: "" };
        const thoughtsPromise = (async () => {
            for await (const chunk of streamParser.stream<any>("thoughts")) {
                const [key, value] = Object.entries(chunk)[0];
                thoughts = { ...thoughts, [key]: value };
                this.logger.debug(`[流式思考] 🤔 ${key}: ${value}`);
            }
            //this.displayThoughts(thoughts);
            await this.interactionManager.recordThought(turnId, platform, channelId, thoughts);
        })();

        const actionsPromise = (async () => {
            let count = 1;
            for await (const action of streamParser.stream<any>("actions")) {
                this.logger.info(`[流式执行] ⚡️ 动作 #${count++}: ${action.function} (耗时: ${Date.now() - stime}ms)`);
                await this.executeActions(turnId, session, [action]);
            }
        })();

        let request_heartbeat = false;
        const heartbeatPromise = (async () => {
            for await (const chunk of streamParser.stream<boolean>("request_heartbeat")) {
                request_heartbeat = Boolean(chunk);
                this.logger.debug(`[流式心跳] ❤️ request_heartbeat: ${request_heartbeat}`);
            }
        })();

        // 等待所有流处理完成
        await Promise.all([llmPromise, thoughtsPromise, actionsPromise, heartbeatPromise]);

        this.logger.success("单次心跳成功完成");
        return { continue: request_heartbeat };
    }

    /**
     * 解析并验证来自LLM的响应
     */
    private parseAndValidateResponse(llmRawResponse: GenerateTextResult, cid: string): Omit<AgentResponse, "observations"> | null {
        const errorContext = {
            rawResponse: llmRawResponse.text,
            cid,
            promptTokens: llmRawResponse.usage?.prompt_tokens,
            completionTokens: llmRawResponse.usage?.completion_tokens,
        };
        const parser = new JsonParser<AgentResponse>();

        const { data, error } = parser.parse(llmRawResponse.text);
        if (error || !data) {
            const parseError = new AppError(ErrorDefinitions.LLM.OUTPUT_PARSING_FAILED, { cause: error as any, context: errorContext });
            handleError(this.logger, parseError, `解析LLM响应时 (CID: ${cid})`);
            return null;
        }

        if (!data.thoughts || typeof data.thoughts !== "object" || !Array.isArray(data.actions)) {
            const formatError = new AppError(ErrorDefinitions.LLM.OUTPUT_PARSING_FAILED, { context: errorContext });
            handleError(this.logger, formatError, `验证LLM响应格式时 (CID: ${cid})`);
            return null;
        }

        data.request_heartbeat = typeof data.request_heartbeat === "boolean" ? data.request_heartbeat : false;

        return data as Omit<AgentResponse, "observations">;
    }

    private displayThoughts(thoughts: AgentResponse["thoughts"]) {
        if (!thoughts) return;
        const { observe, analyze_infer, plan } = thoughts;
        this.logger.info(`[思考过程]
  - 观察: ${observe || "N/A"}
  - 分析: ${analyze_infer || "N/A"}
  - 计划: ${plan || "N/A"}`);
    }

    private async executeActions(turnId: string, session: Session, actions: AgentResponse["actions"]): Promise<void> {
        if (actions.length === 0) {
            this.logger.info("无动作需要执行");
            return;
        }

        const { platform, channelId } = session;

        for await (const action of actions) {
            const actionId = await this.interactionManager.recordAction(turnId, platform, channelId, action);
            const result = await this.toolService.invoke(action.function, action.params, session);
            await this.interactionManager.recordObservation(actionId, platform, channelId, {
                turnId,
                function: action.function,
                status: result.status,
                result: result.result,
                error: result.error,
            });
        }
    }
}

function _toString(obj) {
    if (typeof obj === "string") return obj;
    return JSON.stringify(obj);
}

function prepareDataForTemplate(tools: ToolSchema[]) {
    const processParams = (params: Properties, indent = ""): any[] => {
        return Object.entries(params).map(([key, param]) => {
            const processedParam: any = { ...param, key, indent };
            if (param.properties) {
                processedParam.properties = processParams(param.properties, indent + "    ");
            }
            if (param.items?.properties) {
                processedParam.items = [
                    {
                        ...param.items,
                        key: "item",
                        indent: indent + "    ",
                        properties: processParams(param.items.properties, indent + "        "),
                    },
                ];
            }
            return processedParam;
        });
    };
    return tools.map((tool) => ({
        ...tool,
        parameters: tool.parameters ? processParams(tool.parameters) : [],
    }));
}
