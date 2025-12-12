import type { GenerateTextResult } from "@xsai/generate-text";
import type { Message } from "@xsai/shared-chat";
import type { Context, Logger } from "koishi";
import type { Config } from "@/config";

import type { HorizonService, Percept } from "@/services/horizon";
import type { MemoryService } from "@/services/memory";
import type { ChatModelSwitcher, SelectedChatModel } from "@/services/model";
import type { FunctionContext, FunctionSchema, PluginService } from "@/services/plugin";
import type { PromptService } from "@/services/prompt";
import { generateText, streamText } from "xsai";
import { h, Random } from "koishi";
import { TimelineEventType, TimelinePriority, TimelineStage } from "@/services/horizon";
import { ModelError } from "@/services/model/types";
import { FunctionType } from "@/services/plugin";
import { Services } from "@/shared";
import { estimateTokensByRegex, formatDate, JsonParser } from "@/shared/utils";

export class HeartbeatProcessor {
    private logger: Logger;
    private prompt: PromptService;
    private plugin: PluginService;
    private horizon: HorizonService;
    private memory: MemoryService;
    constructor(
        public ctx: Context,
        private readonly config: Config,
        private readonly modelSwitcher: ChatModelSwitcher,
    ) {
        this.logger = ctx.logger("heartbeat");
        this.prompt = ctx[Services.Prompt];
        this.plugin = ctx[Services.Plugin];
        this.horizon = ctx[Services.Horizon];
        this.memory = ctx[Services.Memory];
    }

    public async runCycle(percept: Percept): Promise<boolean> {
        const turnId = Random.id();
        let shouldContinueHeartbeat = true;
        let heartbeatCount = 0;
        let success = false;

        while (shouldContinueHeartbeat && heartbeatCount < this.config.heartbeat) {
            heartbeatCount++;
            try {
                this.logger.info(`Heartbeat | 第 ${heartbeatCount}/${this.config.heartbeat} 轮`);
                const result = await this.performSingleHeartbeat(turnId, percept);

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
        // 回合结束后清理工作记忆
        this.horizon.events.clearWorkingMemory(percept.scope);
        return success;
    }

    private async executeModelChat(selected: SelectedChatModel, options: {
        messages: Message[];
        stream: boolean;
        abortSignal?: AbortSignal;
        temperature?: number;
    }): Promise<GenerateTextResult> {
        if (!options.stream) {
            return await generateText({
                ...selected.options,
                messages: options.messages,
                abortSignal: options.abortSignal,
                temperature: options.temperature,
            } as any);
        }

        const stime = Date.now();
        const finalContentParts: string[] = [];

        const { textStream, usage } = streamText({
            ...selected.options,
            messages: options.messages,
            abortSignal: options.abortSignal,
            temperature: options.temperature,
            streamOptions: { includeUsage: true },
        } as any);

        usage.catch(() => {});

        for await (const textDelta of textStream) {
            if (textDelta === "")
                continue;
            finalContentParts.push(textDelta);
        }

        const finalText = finalContentParts.join("");
        if (!finalText) {
            throw new Error("模型未输出有效内容");
        }

        this.logger.debug(`传输完成 | 总耗时: ${Date.now() - stime}ms`);

        return {
            steps: [] as any,
            messages: [],
            text: finalText,
            toolCalls: [],
            toolResults: [],
            usage: undefined,
            finishReason: "unknown",
        };
    }

    private async performSingleHeartbeat(turnId: string, percept: Percept): Promise<{ continue: boolean } | null> {
        let attempt = 0;

        let llmRawResponse: GenerateTextResult | null = null;

        // 步骤 1-4: 准备请求
        // 1. 构建非消息部分的上下文
        this.logger.debug("步骤 1/4: 构建提示词上下文...");

        const { view, templates, partials } = await this.horizon.build(percept);

        const context: FunctionContext = {
            session: percept.type === "user.message" ? percept.runtime?.session : undefined,
            percept,
            view,
            horizon: this.horizon,
        };

        const funcs = await this.plugin.filterAvailableFuncs(context);

        const funcSchemas: FunctionSchema[] = funcs.map((def) => this.plugin.toSchema(def));

        // 2. 准备模板渲染所需的数据视图 (View)
        this.logger.debug("步骤 2/4: 准备模板渲染视图...");

        // 分离 tools 和 actions
        const tools = funcSchemas.filter((f) => f.type === "tool");
        const actions = funcSchemas.filter((f) => f.type === "action" || !f.type);

        const renderView = {
            // 从 ChatMode 构建的视图数据
            ...view,

            session: context.session,

            // 工具定义（分离为 tools 和 actions）
            tools: formatFunction(tools),
            actions: formatFunction(actions),

            // 记忆块
            memoryBlocks: this.memory.getMemoryBlocksForRendering(),

            // 模板辅助函数
            _toString() {
                try {
                    return _toString(this);
                } catch (err) {
                    // FIXME: use external this context
                    return "";
                }
            },
            _renderParams() {
                try {
                    const content = [];
                    for (const param of Object.keys(this.params)) {
                        content.push(`<${param}>${_toString(this.params[param])}</${param}>`);
                    }
                    return content.join("");
                } catch (err) {
                    // FIXME: use external this context
                    return "";
                }
            },
            _truncate() {
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
            _formatDate() {
                try {
                    return formatDate(this, "MM-DD HH:mm");
                } catch (err) {
                    // FIXME: use external this context
                    return "";
                }
            },
            _formatTime() {
                try {
                    return formatDate(this, "HH:mm");
                } catch (err) {
                    // FIXME: use external this context
                    return "";
                }
            },
        };

        // 3. 渲染核心提示词文本
        this.logger.debug("步骤 3/4: 渲染提示词模板...");
        const systemPrompt = await this.prompt.render(templates.system, renderView);
        const userPromptText = await this.prompt.render(templates.user, renderView);

        // 4. 条件化构建多模态上下文并组装最终的 messages
        this.logger.debug("步骤 4/4: 构建最终消息...");

        const messages: Message[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPromptText },
        ];

        let selected: SelectedChatModel | null = null;

        let startTime: number;

        while (attempt < this.config.switchConfig.maxRetries) {
            const parser = new JsonParser<AgentResponse>();

            selected = this.modelSwitcher.getModel();

            // 步骤 5: 调用LLM
            this.logger.info("步骤 5/7: 调用大语言模型...");

            startTime = Date.now();

            try {
                if (!selected) {
                    this.logger.warn("未找到合适的模型，跳过本次心跳");
                    break;
                }

                const controller = new AbortController();

                const timeout = setTimeout(() => {
                    if (this.config.stream)
                        controller.abort("请求超时");
                }, this.config.switchConfig.firstToken);

                llmRawResponse = await this.executeModelChat(selected, {
                    messages,
                    stream: this.config.stream,
                    abortSignal: AbortSignal.any([
                        AbortSignal.timeout(this.config.switchConfig.requestTimeout),
                        controller.signal,
                    ]),
                });
                clearTimeout(timeout);
                const prompt_tokens
                    = llmRawResponse.usage?.prompt_tokens
                        || `~${estimateTokensByRegex(messages.map((m) => m.content).join())}`;
                const completion_tokens
                    = llmRawResponse.usage?.completion_tokens || `~${estimateTokensByRegex(llmRawResponse.text)}`;
                /* prettier-ignore */
                this.logger.info(`💰 Token 消耗 | 输入: ${prompt_tokens} | 输出: ${completion_tokens} | 耗时: ${new Date().getTime() - startTime}ms`);
                this.modelSwitcher.recordResult(selected.fullName, true, undefined, Date.now() - startTime);
                break; // 成功调用，跳出重试循环
            } catch (error) {
                attempt++;
                this.modelSwitcher.recordResult(
                    selected?.fullName ?? "",
                    false,
                    ModelError.classify(error instanceof Error ? error : new Error(String(error))),
                    Date.now() - startTime,
                );
                if (attempt < this.config.switchConfig.maxRetries) {
                    this.logger.info(
                        `重试调用 LLM (第 ${attempt + 1} 次，共 ${this.config.switchConfig.maxRetries} 次)...`,
                    );
                    continue;
                } else {
                    this.logger.error("达到最大重试次数，跳过本次心跳");
                    return { continue: false };
                }
            }
        }

        // 步骤 6: 解析和验证响应
        this.logger.debug("步骤 6/7: 解析并验证LLM响应");
        const agentResponseData = this.parseAndValidateResponse(llmRawResponse);
        if (!agentResponseData) {
            this.logger.error("LLM响应解析或验证失败，终止本次心跳");
            this.modelSwitcher.recordResult(
                selected?.fullName ?? "",
                false,
                ModelError.classify(new Error("Invalid LLM response format")),
                new Date().getTime() - startTime,
            );
            return null;
        }

        if (selected) {
            this.modelSwitcher.recordResult(selected.fullName, true, undefined, new Date().getTime() - startTime);
        }

        // this.displayThoughts(agentResponseData.thoughts);

        // 步骤 7: 执行动作
        this.logger.debug(`步骤 7/7: 执行 ${agentResponseData.actions.length} 个动作...`);

        let actionContinue = false;

        const agentActions = agentResponseData.actions;

        if (agentActions.length === 0) {
            this.logger.info("无动作需要执行");
            actionContinue = false;
        }

        for (let index = 0; index < agentActions.length; index++) {
            const action = agentActions[index];
            if (!action?.name)
                continue;

            const result = await this.plugin.invoke(action.name, action.params ?? {}, context);

            const def = await this.plugin.getFunction(action.name, context);

            if (def && def.type === FunctionType.Tool) {
                this.logger.debug(`工具 "${action.name}" 触发心跳继续`);
                actionContinue = true;

                await this.horizon.events.record({
                    id: Random.id(),
                    timestamp: new Date(),
                    scope: percept.scope,
                    priority: TimelinePriority.Normal,
                    type: TimelineEventType.AgentTool,
                    stage: TimelineStage.Active,
                    data: {
                        name: action.name,
                        args: action.params || {},
                    },
                });

                await this.horizon.events.record({
                    id: Random.id(),
                    timestamp: new Date(),
                    scope: percept.scope,
                    priority: TimelinePriority.Normal,
                    type: TimelineEventType.ToolResult,
                    stage: TimelineStage.Active,
                    data: {
                        status: result.status,
                        result: result.result,
                    },
                });
            } else if (def && def.type === FunctionType.Action) {
                await this.horizon.events.record({
                    id: Random.id(),
                    timestamp: new Date(),
                    scope: percept.scope,
                    priority: TimelinePriority.Normal,
                    type: TimelineEventType.AgentAction,
                    stage: TimelineStage.Active,
                    data: {
                        name: action.name,
                        args: action.params || {},
                    },
                });
            }
        }

        this.logger.success("单次心跳成功完成");

        await this.horizon.events.markAsActive(percept.scope, new Date());

        // Continue heartbeat if: any Tool was called OR LLM explicitly requests it
        const shouldContinue = agentResponseData.request_heartbeat || actionContinue;
        return { continue: shouldContinue };
    }

    /**
     * 解析并验证来自LLM的响应
     */
    private parseAndValidateResponse(llmRawResponse: GenerateTextResult): AgentResponse | null {
        const parser = new JsonParser<AgentResponse>();

        const { data, error } = parser.parse(llmRawResponse.text);
        if (error || !data) {
            return null;
        }

        // if (!data.thoughts || typeof data.thoughts !== "object" || !Array.isArray(data.actions)) {
        //     return null;
        // }

        if (!Array.isArray(data.actions))
            return null;

        data.request_heartbeat = typeof data.request_heartbeat === "boolean" ? data.request_heartbeat : false;

        return data;
    }

    //     private displayThoughts(thoughts: AgentResponse["thoughts"]) {
    //         if (!thoughts) return;
    //         const { observe, analyze_infer, plan } = thoughts;
    //         this.logger.info(`[思考过程]
    //   - 观察: ${observe || "N/A"}
    //   - 分析: ${analyze_infer || "N/A"}
    //   - 计划: ${plan || "N/A"}`);
    //     }
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
    if (typeof obj === "string")
        return obj;
    return JSON.stringify(obj);
}

function formatFunction(tools: FunctionSchema[]): string[] {
    return tools.map((tool) => {
        return JSON.stringify({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        });
    });
}

interface AgentResponse {
    // thoughts: {
    //     observe?: string;
    //     analyze_infer?: string;
    //     plan?: string;
    // };
    actions: Array<{
        name: string;
        params?: Record<string, any>;
    }>;
    request_heartbeat: boolean;
}
