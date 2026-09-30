import { assertReplyTurn, replyTurnSignal } from "@/agent/reply-turn";
import type { Tool } from "@xsai/shared-chat";
import { toolJSONSchema } from "@/services/extension/json-schema";
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
import { PromptContextBuilder } from "./context-builder";

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
     * @returns 返回 true 如果至少有一次 send_message 成功
     */
    public async runCycle(stimulus: AgentStimulus<any>): Promise<boolean> {
        const turnId = uuidv4();
        let shouldContinueHeartbeat = true;
        let heartbeatCount = 0;
        let success = false;

        while (shouldContinueHeartbeat && heartbeatCount < this.config.heartbeat) {
            assertReplyTurn();
            heartbeatCount++;
            try {
                this.logger.info(`Heartbeat | 第 ${heartbeatCount}/${this.config.heartbeat} 轮`);
                const onReplySent = () => {
                    success = true;
                };
                const result = this.config.nativeToolCalling
                    ? await this.performNativeHeartbeat(turnId, stimulus, onReplySent)
                    : this.config.streamAction
                      ? await this.performSingleHeartbeatWithStreaming(turnId, stimulus, onReplySent)
                      : await this.performSingleHeartbeat(turnId, stimulus, onReplySent);

                if (result) {
                    shouldContinueHeartbeat = result.continue;
                    success = success || result.replySent;
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
                try {
                    return _toString(this);
                } catch (err) {
                    // FIXME: use external this context
                    return "";
                }
            },
            _renderParams: function () {
                try {
                    const content = [];
                    for (let param of Object.keys(this.params)) {
                        content.push(`<${param}>${_toString(this.params[param])}</${param}>`);
                    }
                    return content.join("");
                } catch (err) {
                    // FIXME: use external this context
                    return "";
                }
            },
            _truncate: function () {
                try {
                    const length = 100; // TODO: 从配置读取
                    const text = h
                        .parse(this)
                        .filter((e) => e.type === "text")
                        .join("");
                    return text.length > length
                        ? `<unverified><note>这是一条用户发送的长消息，请注意甄别内容真实性。</note>${this}</unverified>`
                        : this.toString();
                } catch (err) {
                    // FIXME: use external this context
                    return "";
                }
            },
            _formatDate: function () {
                try {
                    return formatDate(this, "MM-DD HH:mm");
                } catch (err) {
                    // FIXME: use external this context
                    return "";
                }
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
    private async performSingleHeartbeat(
        turnId: string,
        stimulus: AgentStimulus<any>,
        onReplySent: () => void
    ): Promise<{ continue: boolean; replySent: boolean } | null> {
        const { session } = stimulus;
        const { platform, channelId } = session;
        const parser = new JsonParser<AgentResponse>();

        // 步骤 1-4: 准备请求
        const { messages } = await this._prepareLlmRequest(stimulus);

        // 步骤 5: 调用LLM
        this.logger.info("步骤 5/7: 调用大语言模型...");
        assertReplyTurn();
        const llmRawResponse = await this.modelSwitcher.chat({
            messages,
            abortSignal: replyTurnSignal(),
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
        const replySent = await this.executeActions(turnId, session, agentResponseData.actions, onReplySent);

        if (replySent) this.logger.success("单次心跳成功完成");
        else this.logger.debug("单次心跳完成，未成功发送回复");
        return { continue: agentResponseData.request_heartbeat, replySent };
    }

    /**
     * 执行单次心跳的完整逻辑（流式，支持重试批次切换）
     */
    private async performSingleHeartbeatWithStreaming(
        turnId: string,
        stimulus: AgentStimulus<any>,
        onReplySent: () => void
    ): Promise<{ continue: boolean; replySent: boolean } | null> {
        const { session } = stimulus;
        const { platform, channelId } = session;

        // 步骤 1-4: 准备请求
        const { messages } = await this._prepareLlmRequest(stimulus);

        this.logger.info("步骤 5/7: 调用大语言模型...");
        const stime = Date.now();

        interface ConsumerBatch {
            controller: AbortController;
            promises: Promise<any>[];
            id: number;
        }

        let batchCounter = 0;
        let currentBatch: ConsumerBatch | null = null;

        let thoughts = { observe: "", analyze_infer: "", plan: "" };
        let request_heartbeat = false;
        // 批次切换不能丢失已经开始执行的发送结果。
        const pendingActions: Promise<boolean>[] = [];

        let streamParser = new StreamParser({
            thoughts: { observe: "string", analyze_infer: "string", plan: "string" },
            actions: [{ function: "string", params: "any" }],
            request_heartbeat: "boolean",
        });

        // 启动一个批次的消费者
        const startConsumers = () => {
            // 中断并结束旧批次
            if (currentBatch) {
                this.logger.warn(`中断旧批次 #${currentBatch.id}`);
                currentBatch.controller.abort();
            }

            const id = ++batchCounter;
            const controller = new AbortController();
            const signal = controller.signal;

            // 重置数据
            thoughts = { observe: "", analyze_infer: "", plan: "" };
            request_heartbeat = false;

            this.logger.debug(`启动新批次消费者 #${id}`);

            const thoughtsPromise = (async () => {
                this.logger.debug(`[批次 ${id}] thoughts consumer start`);
                try {
                    for await (const chunk of streamParser.stream<any>("thoughts")) {
                        if (signal.aborted) break;
                        const [key, value] = Object.entries(chunk)[0];
                        thoughts = { ...thoughts, [key]: value };
                        this.logger.debug(`[流式思考 #${id}] 🤔 ${key}: ${value}`);
                    }
                } finally {
                    this.logger.debug(`[批次 ${id}] thoughts consumer end`);
                    await this.interactionManager.recordThought(turnId, platform, channelId, thoughts);
                }
            })();

            const actionsPromise = (async () => {
                this.logger.debug(`[批次 ${id}] actions consumer start`);
                let count = 1;
                for await (const action of streamParser.stream<any>("actions")) {
                    if (signal.aborted) break;
                    this.logger.info(`[流式执行 #${id}] ⚡️ 动作 #${count++}: ${action.function} (耗时: ${Date.now() - stime}ms)`);
                    const pending = this.executeActions(turnId, session, [action], onReplySent);
                    pendingActions.push(pending);
                    await pending;
                }
                this.logger.debug(`[批次 ${id}] actions consumer end`);
            })();

            const heartbeatPromise = (async () => {
                this.logger.debug(`[批次 ${id}] heartbeat consumer start`);
                for await (const chunk of streamParser.stream<boolean>("request_heartbeat")) {
                    if (signal.aborted) break;
                    request_heartbeat = Boolean(chunk);
                    this.logger.debug(`[流式心跳 #${id}] ❤️ request_heartbeat: ${request_heartbeat}`);
                }
                this.logger.debug(`[批次 ${id}] heartbeat consumer end`);
            })();

            currentBatch = {
                controller,
                promises: [thoughtsPromise, actionsPromise, heartbeatPromise],
                id,
            };
            // 动作可能在模型结束之前失败，立即观察以避免未处理的拒绝。
            currentBatch.promises.forEach((promise) => {
                void promise.catch(() => {});
            });
        };

        // 第一次启动消费者
        startConsumers();

        const finalValidatorParser = new JsonParser<any>();

        assertReplyTurn();
        const llmPromise = this.modelSwitcher.chat({
            messages,
            abortSignal: replyTurnSignal(),
            stream: true,
            validation: {
                format: "json",
                validator: (text, final) => {
                    if (!final) {
                        try {
                            streamParser.processText(text, false);
                        } catch (e) {
                            if (!e.message.includes("Cannot read properties of null")) {
                                this.logger.warn(`流式解析器错误: ${e.message}`);
                            }
                        }
                        return { valid: true, earlyExit: false };
                    }

                    const { data, error } = finalValidatorParser.parse(text);

                    if (error) {
                        this.logger.warn("最终JSON解析失败，即将触发重试...");
                        // 用新的 parser 启动新的批次
                        streamParser = new StreamParser({
                            thoughts: { observe: "string", analyze_infer: "string", plan: "string" },
                            actions: [{ function: "string", params: "any" }],
                            request_heartbeat: "boolean",
                        });
                        startConsumers();
                        return { valid: false, earlyExit: false, error };
                    }

                    try {
                        streamParser.processText(text, true);
                    } catch (e) {
                        /* 忽略完成阶段错误 */
                    }

                    let finalData = data;
                    if (finalData.thoughts && typeof finalData.thoughts.request_heartbeat === "boolean") {
                        finalData.request_heartbeat = finalData.request_heartbeat ?? finalData.thoughts.request_heartbeat;
                    }

                    const isComplete =
                        finalData.thoughts && Array.isArray(finalData.actions) && typeof finalData.request_heartbeat === "boolean";

                    if (isComplete) {
                        return { valid: true, earlyExit: true, parsedData: finalData };
                    }

                    return { valid: true, earlyExit: false, parsedData: finalData };
                },
            },
        });

        // 取消时关闭消费者，即使尚未收到完整 JSON。
        const closeCancelledBatch = () => {
            currentBatch?.controller.abort();
            try {
                streamParser.processText("", true);
            } catch {}
        };
        const turnSignal = replyTurnSignal();
        turnSignal?.addEventListener("abort", closeCancelledBatch, { once: true });
        try {
            if (turnSignal?.aborted) closeCancelledBatch();
            await llmPromise;
            if (currentBatch) await Promise.all(currentBatch.promises);
        } finally {
            turnSignal?.removeEventListener("abort", closeCancelledBatch);
            closeCancelledBatch();
            // 模型失败或取消时，也要等已开始的动作结束后再释放频道锁。
            await Promise.allSettled(pendingActions);
            if (turnSignal?.aborted && currentBatch) await Promise.allSettled(currentBatch.promises);
        }

        const replySent = (await Promise.all(pendingActions)).some(Boolean);
        if (replySent) this.logger.success("单次心跳成功完成");
        else this.logger.debug("单次心跳完成，未成功发送回复");
        return { continue: request_heartbeat, replySent };
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

    private async performNativeHeartbeat(
        turnId: string,
        stimulus: AgentStimulus<any>,
        onReplySent: () => void
    ): Promise<{ continue: boolean; replySent: boolean }> {
        const session = stimulus.session;
        const { messages } = await this._prepareLlmRequest(stimulus);
        messages.push({
            role: "system",
            content:
                "本轮启用原生工具调用。请通过工具接口执行动作，不要输出 JSON actions；需要先查询时，先调用查询工具，获得结果后下一轮再决策。使用 send_message 发送回复。",
        });
        const definitions = this.toolService.getAvailableTools(session);
        if (!definitions.length) throw new Error("当前会话没有可用工具");
        const tools: Tool[] = definitions.map((definition) => ({
            type: "function",
            function: { name: definition.name, description: definition.description, parameters: toolJSONSchema(definition.parameters) },
            // SDK 阶段不执行任何真实工具，失败重试不会重放消息。
            execute: () => ({}),
        }));
        assertReplyTurn();
        const response = await this.modelSwitcher.chat({
            messages,
            tools,
            toolChoice: "required",
            maxSteps: 1,
            singleStep: true,
            abortSignal: replyTurnSignal(),
        });
        assertReplyTurn();
        if (!response.toolCalls?.length) {
            const legacy = this.parseAndValidateResponse(response, session.cid);
            if (!legacy) throw new Error("模型没有返回有效工具调用");
            const replySent = await this.executeActions(turnId, session, legacy.actions, onReplySent);
            return { continue: legacy.request_heartbeat, replySent };
        }
        const seen = new Map<string, string>();
        const actions: Array<{ function: string; params: Record<string, unknown> }> = [];
        // 完整校验后才执行，防止坏调用旁边的发送动作先发生。
        for (const call of response.toolCalls) {
            const params = JSON.parse(call.args);
            if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("工具参数必须是对象");
            const definition = this.toolService.getTool(call.toolName, session);
            if (!definition) throw new Error(`工具不可用: ${call.toolName}`);
            definition.parameters(params);
            const signature = JSON.stringify([call.toolName, params]);
            if (seen.has(call.toolCallId)) {
                if (seen.get(call.toolCallId) !== signature) throw new Error("工具调用 ID 重复但参数不同");
                continue;
            }
            seen.set(call.toolCallId, signature);
            actions.push({ function: call.toolName, params });
        }
        let replySent = false;
        for (const action of actions) {
            assertReplyTurn();
            const actionId = await this.interactionManager.recordAction(turnId, session.platform, session.channelId, action);
            assertReplyTurn();
            const result = await this.toolService.invoke(action.function, action.params, session);
            if (action.function === "send_message" && result.status === "success") {
                replySent = true;
                onReplySent();
            }
            await this.interactionManager.recordObservation(actionId, session.platform, session.channelId, {
                turnId,
                ...action,
                status: result.status,
                result: result.result,
                error: result.error,
            });
            if (result.status !== "success") throw new Error(`工具 ${action.function} 执行失败: ${result.error?.message ?? "未知错误"}`);
        }
        return { continue: !actions.some((action) => action.function === "send_message"), replySent };
    }

    private displayThoughts(thoughts: AgentResponse["thoughts"]) {
        if (!thoughts) return;
        const { observe, analyze_infer, plan } = thoughts;
        this.logger.info(`[思考过程]
  - 观察: ${observe || "N/A"}
  - 分析: ${analyze_infer || "N/A"}
  - 计划: ${plan || "N/A"}`);
    }

    private async executeActions(
        turnId: string,
        session: Session,
        actions: AgentResponse["actions"],
        onReplySent: () => void
    ): Promise<boolean> {
        if (actions.length === 0) {
            this.logger.info("无动作需要执行");
            return false;
        }

        const { platform, channelId } = session;
        let replySent = false;

        for await (const action of actions) {
            if (!action.function) continue; // FIXME: params is nullable
            assertReplyTurn();
            const actionId = await this.interactionManager.recordAction(turnId, platform, channelId, action);
            assertReplyTurn();
            const result = await this.toolService.invoke(action.function, action.params, session);
            if (action.function === "send_message" && result.status === "success") {
                replySent = true;
                onReplySent();
            }
            await this.interactionManager.recordObservation(actionId, platform, channelId, {
                turnId,
                function: action.function,
                status: result.status,
                result: result.result,
                error: result.error,
            });
        }
        return replySent;
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
