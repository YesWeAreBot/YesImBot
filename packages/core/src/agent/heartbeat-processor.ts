import { GenerateTextResult } from "@xsai/generate-text";
import { Message } from "@xsai/shared-chat";
import { Context, h, Logger } from "koishi";
import { v4 as uuidv4 } from "uuid";

import { Config } from "@/config";
import { Properties, ToolRuntime, ToolSchema, ToolService } from "@/services/extension";
import { ChatModelSwitcher } from "@/services/model";
import { ChatModelType, ModelError } from "@/services/model/types";
import { PromptService } from "@/services/prompt";
import { AnyAgentStimulus, HistoryManager, WorldStateService } from "@/services/worldstate";
import { Services } from "@/shared";
import { estimateTokensByRegex, formatDate, JsonParser } from "@/shared/utils";
import { MemoryService } from "@/services/memory";

export class HeartbeatProcessor {
    private logger: Logger;
    private promptService: PromptService;
    private toolService: ToolService;
    private history: HistoryManager;
    private worldState: WorldStateService;
    private memoryService: MemoryService;
    constructor(
        ctx: Context,
        private readonly config: Config,
        private readonly modelSwitcher: ChatModelSwitcher
    ) {
        this.logger = ctx.logger("heartbeat");
        this.logger.level = config.logLevel;
        this.promptService = ctx[Services.Prompt];
        this.toolService = ctx[Services.Tool];
        this.worldState = ctx[Services.WorldState];
        this.history = this.worldState.history;
        this.memoryService = ctx[Services.Memory];
    }

    public async runCycle(stimulus: AnyAgentStimulus): Promise<boolean> {
        const turnId = uuidv4();
        let shouldContinueHeartbeat = true;
        let heartbeatCount = 0;
        let success = false;

        while (shouldContinueHeartbeat && heartbeatCount < this.config.heartbeat) {
            heartbeatCount++;
            try {
                this.logger.info(`Heartbeat | 第 ${heartbeatCount}/${this.config.heartbeat} 轮`);
                const result = await this.performSingleHeartbeat(turnId, stimulus);

                if (result) {
                    shouldContinueHeartbeat = result.continue;
                    success = true; // 至少成功一次心跳
                } else {
                    shouldContinueHeartbeat = false;
                }
            } catch (error: any) {
                this.logger.error(`Heartbeat #${heartbeatCount} 处理失败: ${error.message}`);

                shouldContinueHeartbeat = false;
            }
        }
        return success;
    }

    /* prettier-ignore */
    private async _prepareLlmRequest(stimulus: AnyAgentStimulus): Promise<Message[]> {
        // 1. 构建非消息部分的上下文
        this.logger.debug("步骤 1/4: 构建提示词上下文...");

        const worldState = await this.worldState.buildWorldState(stimulus);
        const runtime = this.toolService.getRuntime(stimulus);

        const toolSchemas = await this.toolService.getToolSchemas(runtime);



        // 2. 准备模板渲染所需的数据视图 (View)
        this.logger.debug("步骤 2/4: 准备模板渲染视图...");
        const view = {
            TOOL_DEFINITION: prepareDataForTemplate(toolSchemas),
            MEMORY_BLOCKS: this.memoryService.getMemoryBlocksForRendering(),
            WORLD_STATE: worldState,
            triggerContext: worldState.triggerContext,
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

        const messages: Message[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPromptText },
        ];

        return messages
    }

    private async performSingleHeartbeat(turnId: string, stimulus: AnyAgentStimulus): Promise<{ continue: boolean } | null> {
        let attempt = 0;

        let llmRawResponse: GenerateTextResult | null = null;

        while (attempt < this.config.switchConfig.maxRetries) {
            const parser = new JsonParser<AgentResponse>();

            // 步骤 1-4: 准备请求
            const messages = await this._prepareLlmRequest(stimulus);

            // 步骤 5: 调用LLM
            this.logger.info("步骤 5/7: 调用大语言模型...");

            const model = this.modelSwitcher.getModel();
            const startTime = Date.now();

            try {
                if (!model) {
                    this.logger.warn("未找到合适的模型，跳过本次心跳");
                    break;
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

        // 步骤 7: 执行动作
        this.logger.debug(`步骤 7/7: 执行 ${agentResponseData.actions.length} 个动作...`);
        await this.executeActions(turnId, stimulus, agentResponseData.actions);

        this.logger.success("单次心跳成功完成");
        return { continue: agentResponseData.request_heartbeat };
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

    private async executeActions(turnId: string, stimulus: AnyAgentStimulus, actions: AgentResponse["actions"]): Promise<void> {
        if (actions.length === 0) {
            this.logger.info("无动作需要执行");
            return;
        }

        const baseInvocation = this.toolService.getRuntime(stimulus, { metadata: { turnId } });

        for (let index = 0; index < actions.length; index++) {
            const action = actions[index];
            if (!action?.function) continue;

            const invocation: ToolRuntime = {
                ...baseInvocation,
                metadata: {
                    ...(baseInvocation.metadata ?? {}),
                    actionIndex: index,
                    actionName: action.function,
                },
            };

            const result = await this.toolService.invoke(action.function, action.params ?? {}, invocation);
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

interface AgentResponse {
    thoughts: {
        observe?: string;
        analyze_infer?: string;
        plan?: string;
    };
    actions: Array<{
        function: string;
        params?: Record<string, any>;
    }>;
    request_heartbeat: boolean;
}
