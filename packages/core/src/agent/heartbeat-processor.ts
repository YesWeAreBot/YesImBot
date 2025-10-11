import { GenerateTextResult } from "@xsai/generate-text";
import { Message } from "@xsai/shared-chat";
import { Context, h, Logger, Session } from "koishi";
import { v4 as uuidv4 } from "uuid";

import { Config } from "@/config";
import { Properties, ToolInvocation, ToolKitService, ToolSchema } from "@/services/extension";
import { ChatModelSwitcher } from "@/services/model";
import { ChatModelType, ModelError } from "@/services/model/types";
import { PromptService } from "@/services/prompt";
import { AgentResponse, AnyAgentStimulus, StimulusSource, WorldState } from "@/services/worldstate";
import { InteractionManager } from "@/services/worldstate/interaction-manager";
import { Services } from "@/shared";
import { estimateTokensByRegex, formatDate, JsonParser, StreamParser } from "@/shared/utils";
import { PromptContextBuilder } from "./context-builder";

type PromptContextSnapshot = Awaited<ReturnType<PromptContextBuilder["build"]>>;

/**
 * @description 负责执行 Agent 的核心“心跳”循环
 * 它协调上下文构建、LLM调用、响应解析和动作执行
 */
export class HeartbeatProcessor {
    private logger: Logger;
    private promptService: PromptService;
    private toolService: ToolKitService;
    constructor(
        ctx: Context,
        private readonly config: Config,
        private readonly modelSwitcher: ChatModelSwitcher,
        private readonly interactionManager: InteractionManager,
        private readonly contextBuilder: PromptContextBuilder
    ) {
        this.logger = ctx.logger("heartbeat");
        this.logger.level = config.logLevel;
        this.promptService = ctx[Services.Prompt];
        this.toolService = ctx[Services.Tool];
    }

    /**
     * 运行完整的 Agent 思考-行动周期
     * @returns 返回 true 如果至少有一次心跳成功
     */
    public async runCycle(stimulus: AnyAgentStimulus): Promise<boolean> {
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
                    const session = this.getSessionFromStimulus(stimulus);
                    if (session) {
                        await this.interactionManager.recordHeartbeat(
                            turnId,
                            session.platform,
                            session.channelId,
                            heartbeatCount,
                            this.config.heartbeat
                        );
                    }
                }
            } catch (error: any) {
                this.logger.error(`Heartbeat #${heartbeatCount} 处理失败: ${error.message}`);
                shouldContinueHeartbeat = false;
            }
        }
        return success;
    }

    /**
     * 准备LLM请求所需的消息负载
     */
    private async _prepareLlmRequest(
        stimulus: AnyAgentStimulus,
        includeImages: boolean = false
    ): Promise<{ messages: Message[]; includeImages: boolean; promptContext: PromptContextSnapshot }> {
        // 1. 构建非消息部分的上下文
        this.logger.debug("步骤 1/4: 构建提示词上下文...");
        const promptContext = await this.contextBuilder.build(stimulus);

        // 2. 准备模板渲染所需的数据视图 (View)
        this.logger.debug("步骤 2/4: 准备模板渲染视图...");
        const view = {
            session: this.getSessionFromStimulus(stimulus),
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
        const userMessageContent = await this.contextBuilder.buildMultimodalUserMessage(
            userPromptText,
            promptContext.worldState,
            includeImages
        );

        const messages: Message[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessageContent },
        ];

        return { messages, includeImages: userMessageContent instanceof Array, promptContext };
    }

    /**
     * 执行单次心跳的完整逻辑（非流式）
     */
    private async performSingleHeartbeat(turnId: string, stimulus: AnyAgentStimulus): Promise<{ continue: boolean } | null> {
        const baseInvocation = this.toolService.buildInvocation(stimulus);
        const { platform, channelId } = this.resolveInvocationChannel(baseInvocation, stimulus);
        let attempt = 0;

        let llmRawResponse: GenerateTextResult | null = null;

        let includeImages = this.config.enableVision;
        let lastPromptContext: PromptContextSnapshot | null = null;

        while (attempt < this.config.switchConfig.maxRetries) {
            const parser = new JsonParser<AgentResponse>();

            // 步骤 1-4: 准备请求
            const { messages, includeImages: hasImages, promptContext } = await this._prepareLlmRequest(stimulus, includeImages);
            lastPromptContext = promptContext;

            // 步骤 5: 调用LLM
            this.logger.info("步骤 5/7: 调用大语言模型...");

            const model = this.modelSwitcher.getModel(hasImages ? ChatModelType.Vision : ChatModelType.All);
            const startTime = Date.now();

            try {
                if (!model) {
                    if (hasImages) {
                        includeImages = false; // 降级为纯文本
                        continue; // 重试
                    } else {
                        // 所有模型均不可用
                        this.logger.warn("未找到合适的模型，跳过本次心跳");
                        break;
                    }
                }

                const controller = new AbortController();

                const timeout = setTimeout(() => {
                    if (this.config.stream) controller.abort("请求超时");
                }, this.config.switchConfig.firstToken);

                llmRawResponse = await model.chat({
                    messages,
                    stream: this.config.stream,
                    abortSignal: AbortSignal.any([AbortSignal.timeout(this.config.switchConfig.requestTimeout), controller.signal]),
                    validation: {
                        format: "json",
                        validator: (text, final) => {
                            clearTimeout(timeout);
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
                const prompt_tokens =
                    llmRawResponse.usage?.prompt_tokens || `~${estimateTokensByRegex(messages.map((m) => m.content).join())}`;
                const completion_tokens = llmRawResponse.usage?.completion_tokens || `~${estimateTokensByRegex(llmRawResponse.text)}`;
                this.logger.info(`💰 Token 消耗 | 输入: ${prompt_tokens} | 输出: ${completion_tokens}`);
                this.modelSwitcher.recordResult(model, true, undefined, Date.now() - startTime);
                break; // 成功调用，跳出重试循环
            } catch (error) {
                this.logger.error(`调用 LLM 失败: ${error instanceof Error ? error.message : error}`);
                attempt++;
                this.modelSwitcher.recordResult(
                    model,
                    false,
                    ModelError.classify(error instanceof Error ? error : new Error(String(error))),
                    Date.now() - startTime
                );
                if (attempt < this.config.switchConfig.maxRetries) {
                    this.logger.info(`重试调用 LLM (第 ${attempt + 1} 次，共 ${this.config.switchConfig.maxRetries} 次)...`);
                    continue;
                } else {
                    this.logger.error("达到最大重试次数，跳过本次心跳");
                    return { continue: false };
                }
            }
        }

        // 步骤 6: 解析和验证响应
        this.logger.debug("步骤 6/7: 解析并验证LLM响应...");
        const agentResponseData = this.parseAndValidateResponse(llmRawResponse);
        if (!agentResponseData) {
            this.logger.error("LLM响应解析或验证失败，终止本次心跳");
            return null;
        }

        this.displayThoughts(agentResponseData.thoughts);
        await this.interactionManager.recordThought(turnId, platform, channelId, agentResponseData.thoughts);

        // 步骤 7: 执行动作
        this.logger.debug(`步骤 7/7: 执行 ${agentResponseData.actions.length} 个动作...`);
        await this.executeActions(turnId, stimulus, agentResponseData.actions, lastPromptContext?.worldState);

        this.logger.success("单次心跳成功完成");
        return { continue: agentResponseData.request_heartbeat };
    }

    /**
     * 执行单次心跳的完整逻辑（流式，支持重试批次切换）
     */
    /* prettier-ignore */
    private async performSingleHeartbeatWithStreaming(turnId: string, stimulus: AnyAgentStimulus): Promise<{ continue: boolean } | null> {
        const baseInvocation = this.toolService.buildInvocation(stimulus);
        const { platform, channelId } = this.resolveInvocationChannel(baseInvocation, stimulus);

        this.logger.info("步骤 5/7: 调用大语言模型 (流式)...");

        const stime = Date.now();

        interface ConsumerBatch {
            controller: AbortController;
            promises: Promise<any>[];
            id: number;
        }

        let batchCounter = 0;
        let currentBatch: ConsumerBatch | null = null;

        // 这些值会由消费者在每个批次内重置
        let thoughts = { observe: "", analyze_infer: "", plan: "" };
    let request_heartbeat = false;
    let latestPromptContext: PromptContextSnapshot | null = null;

        // factory: 创建新的流式解析器与消费者批次
        let streamParser: StreamParser;
        const startConsumers = () => {
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
                        thoughts = { ...thoughts, [key]: value } as any;
                        this.logger.debug(`[流式思考 #${id}] ${key}: ${value}`);
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
                    await this.executeActions(turnId, stimulus, [action], latestPromptContext?.worldState);
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
        };

        const finalValidatorParser = new JsonParser<any>();

        let attempt = 0;
        let includeImages = this.config.enableVision;

        // 重试与模型切换
        while (attempt < this.config.switchConfig.maxRetries) {
            // 1-4: 为当前尝试构建请求（含多模态）
            const { messages, includeImages: hasImages, promptContext } = await this._prepareLlmRequest(stimulus, includeImages);
            latestPromptContext = promptContext;
            const desiredType = hasImages ? ChatModelType.Vision : ChatModelType.All;
            const model = this.modelSwitcher.getModel(desiredType);

            // 新的解析器与消费者批次
            streamParser = new StreamParser({
                thoughts: { observe: "string", analyze_infer: "string", plan: "string" },
                actions: [{ function: "string", params: "any" }],
                request_heartbeat: "boolean",
            });
            startConsumers();

            const startTime = Date.now();
            let firstTokenTimer: any;
            try {
                if (!model) {
                    if (hasImages) {
                        this.logger.warn("未找到支持多模态的模型，降级为纯文本模式后重试");
                        includeImages = false; // 降级
                        continue; // 不计入重试次数
                    }
                    this.logger.warn("未找到合适的模型（纯文本），终止本次心跳");
                    break;
                }

                this.logger.info(
                    `尝试调用模型（${hasImages ? "Vision" : "Text"}），第 ${attempt + 1}/${this.config.switchConfig.maxRetries} 次...`
                );

                const controller = new AbortController();
                // 首 token 监控：若迟迟未到首 token，则中止请求（仅在流式时）
                firstTokenTimer = setTimeout(() => {
                    try {
                        controller.abort("首 token 超时");
                    } catch {}
                }, this.config.switchConfig.firstToken);

                const llmResult = await model.chat({
                    messages,
                    stream: true,
                    abortSignal: AbortSignal.any([AbortSignal.timeout(this.config.switchConfig.requestTimeout), controller.signal]),
                    validation: {
                        format: "json",
                        validator: (text, final) => {
                            // 一旦收到任何片段，视为首 token 已到
                            if (firstTokenTimer) {
                                clearTimeout(firstTokenTimer);
                                firstTokenTimer = null;
                            }

                            if (!final) {
                                try {
                                    streamParser.processText(text, false);
                                } catch (error: any) {
                                    if (!error?.message?.includes("Cannot read properties of null")) {
                                        this.logger.warn(`流式解析器错误: ${error?.message ?? error}`);
                                    }
                                }
                                return { valid: true, earlyExit: false };
                            }

                            const { data, error } = finalValidatorParser.parse(text);
                            if (error) {
                                this.logger.warn("最终JSON解析失败，准备切换或重试模型...");
                                // 触发重试：返回 invalid 让底层抛出
                                return { valid: false, earlyExit: false, error } as any;
                            }

                            try {
                                streamParser.processText(text, true);
                            } catch {
                                // 忽略完成阶段错误
                            }

                            const finalData = data;
                            if (finalData?.thoughts && typeof finalData.thoughts.request_heartbeat === "boolean") {
                                finalData.request_heartbeat = finalData.request_heartbeat ?? finalData.thoughts.request_heartbeat;
                            }

                            const isComplete =
                                finalData?.thoughts && Array.isArray(finalData.actions) && typeof finalData.request_heartbeat === "boolean";
                            return isComplete
                                ? ({ valid: true, earlyExit: true, parsedData: finalData } as any)
                                : ({ valid: true, earlyExit: false, parsedData: finalData } as any);
                        },
                    },
                });

                // 成功
                if (firstTokenTimer) clearTimeout(firstTokenTimer);
                const prompt_tokens = llmResult.usage?.prompt_tokens ?? "~N/A";
                const completion_tokens = llmResult.usage?.completion_tokens ?? "~N/A";
                this.logger.info(`💰 Token 消耗 | 输入: ${prompt_tokens} | 输出: ${completion_tokens}`);
                this.modelSwitcher.recordResult(model, true, undefined, Date.now() - startTime);

                // 等待最后一个批次完成
                if (currentBatch) {
                    await Promise.all(currentBatch.promises);
                }

                this.logger.success("单次心跳成功完成");
                return { continue: request_heartbeat };
            } catch (error) {
                if (firstTokenTimer) clearTimeout(firstTokenTimer);
                this.logger.error(`调用 LLM (流式) 失败: ${error instanceof Error ? error.message : error}`);
                this.modelSwitcher.recordResult(
                    model,
                    false,
                    ModelError.classify(error instanceof Error ? error : new Error(String(error))),
                    Date.now() - startTime
                );
                attempt++;

                if (attempt < this.config.switchConfig.maxRetries) {
                    this.logger.info(`重试流式调用 LLM (第 ${attempt + 1} 次，共 ${this.config.switchConfig.maxRetries} 次)...`);
                    continue;
                }

                this.logger.error("达到最大重试次数，跳过本次心跳");
                // 终止当前消费者
                if (currentBatch) {
                    currentBatch.controller.abort();
                }
                return { continue: false };
            }
        }

        // 如果未进入成功分支且未命中 return，则认为失败
        if (currentBatch) {
            currentBatch.controller.abort();
        }
        return { continue: false };
    }

    /**
     * 解析并验证来自LLM的响应
     */
    private parseAndValidateResponse(llmRawResponse: GenerateTextResult): Omit<AgentResponse, "observations"> | null {
        const parser = new JsonParser<AgentResponse>();

        const { data, error } = parser.parse(llmRawResponse.text);
        if (error || !data) {
            return null;
        }

        if (!data.thoughts || typeof data.thoughts !== "object" || !Array.isArray(data.actions)) {
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

    private async executeActions(
        turnId: string,
        stimulus: AnyAgentStimulus,
        actions: AgentResponse["actions"],
        worldState?: WorldState
    ): Promise<void> {
        if (actions.length === 0) {
            this.logger.info("无动作需要执行");
            return;
        }

        const baseInvocation = this.toolService.buildInvocation(stimulus, {
            world: worldState,
            metadata: { turnId },
        });

        const { platform, channelId } = this.resolveInvocationChannel(baseInvocation, stimulus);

        for (let index = 0; index < actions.length; index++) {
            const action = actions[index];
            if (!action?.function) continue;

            const invocation: ToolInvocation = {
                ...baseInvocation,
                metadata: {
                    ...(baseInvocation.metadata ?? {}),
                    actionIndex: index,
                    actionName: action.function,
                },
            };

            const actionId = await this.interactionManager.recordAction(turnId, platform, channelId, action);
            const result = await this.toolService.invoke(action.function, action.params ?? {}, invocation);

            await this.interactionManager.recordObservation(actionId, platform, channelId, {
                turnId,
                function: action.function,
                status: result.status,
                result: result.result,
                error: result.error,
            });
        }
    }

    private resolveInvocationChannel(invocation: ToolInvocation, stimulus: AnyAgentStimulus): { platform: string; channelId: string } {
        let platform = invocation.platform;
        let channelId = invocation.channelId;

        if (!platform || !channelId) {
            switch (stimulus.type) {
                case StimulusSource.UserMessage:
                    platform ??= stimulus.payload.platform;
                    channelId ??= stimulus.payload.channelId;
                    break;
                case StimulusSource.SystemEvent:
                    platform ??= stimulus.payload.session?.platform;
                    channelId ??= stimulus.payload.session?.channelId;
                    break;
                case StimulusSource.ScheduledTask:
                case StimulusSource.BackgroundTaskCompletion:
                    platform ??= stimulus.payload.platform;
                    channelId ??= stimulus.payload.channelId;
                    break;
            }
        }

        if (!platform || !channelId) {
            this.logger.warn(`无法确定工具调用的渠道信息 | platform: ${platform ?? "unknown"}, channelId: ${channelId ?? "unknown"}`);
        }

        return {
            platform: platform ?? "unknown",
            channelId: channelId ?? "unknown",
        };
    }

    /**
     * 从刺激中获取 Session 对象
     */
    private getSessionFromStimulus(stimulus: AnyAgentStimulus): Session | null {
        switch (stimulus.type) {
            case StimulusSource.UserMessage:
            case StimulusSource.SystemEvent:
                return stimulus.payload.session;
            case StimulusSource.ScheduledTask:
            case StimulusSource.BackgroundTaskCompletion:
                // 定时任务和后台任务没有 session
                return null;
            default:
                return null;
        }
    }
}

/**
 * Convert a value to a string suitable for templates.
 *
 * If `obj` is already a string it is returned unchanged; otherwise the value
 * is serialized with `JSON.stringify`.
 *
 * @param obj - Value to convert (string or any JSON-serializable value)
 * @returns A string representation of `obj`
 */
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
