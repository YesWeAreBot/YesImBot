import type { CompletionStep, Message } from "@xsai/shared-chat";
import type { Context, Logger } from "koishi";
import type { Config } from "@/config";
import type { HorizonService, Percept } from "@/services/horizon";
import type { MemoryService } from "@/services/memory";
import type { ChatModelSwitcher, SelectedChatModel } from "@/services/model";
import type { FunctionContext, PluginService } from "@/services/plugin";
import type { PromptService } from "@/services/prompt";
import { generateText, streamText } from "@yesimbot/shared-model";
import { h, Random } from "koishi";
import { ModelError } from "@/services/model/types";
import { Services } from "@/shared";
import { estimateTokensByRegex, formatDate, isNotEmpty, JsonParser } from "@/shared/utils";
import { ToolExecution } from "./tool-execution";

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
                    success = result.success ?? true;
                } else {
                    shouldContinueHeartbeat = false;
                }
            } catch (error: any) {
                this.logger.error(`Heartbeat #${heartbeatCount} 处理失败: ${error.message}`);
                shouldContinueHeartbeat = false;
            }
        }
        // 回合结束后清理工作记忆
        await this.horizon.events.clearWorkingMemory(percept.scope);
        return success;
    }

    private async performSingleHeartbeat(turnId: string, percept: Percept): Promise<{ continue: boolean; success?: boolean } | null> {
        let attempt = 0;
        let selected: SelectedChatModel | null = null;
        let startTime: number;
        let controller: AbortController;
        let firstTokenTimeout: NodeJS.Timeout;
        while (attempt < this.config.switchConfig.maxRetries) {
            const { view, templates } = await this.horizon.build(percept);
            const context: FunctionContext = {
                session: percept.type === "user.message" ? percept.runtime?.session : undefined,
                percept,
                view,
                horizon: this.horizon,
            };
            const tools = await this.plugin.getTools(context);
            const renderView = {
                // 从 ChatMode 构建的视图数据
                ...view,
                nativeTools: true,
                session: context.session,
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

            const systemPrompt = await this.prompt.render(templates.system, renderView);
            const userPromptText = await this.prompt.render(templates.user, renderView);
            const messages: Message[] = [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPromptText },
            ];
            selected = this.modelSwitcher.getModel();
            if (!selected) {
                this.logger.warn("未找到合适的模型，跳过本次心跳");
                return { continue: false, success: false };
            }
            startTime = Date.now();
            controller = new AbortController();
            const signal = AbortSignal.any([
                AbortSignal.timeout(this.config.switchConfig.requestTimeout),
                controller.signal,
            ]);
            const execution = new ToolExecution(this.plugin, this.horizon, context, percept, signal);
            try {
                this.logger.info(`调用大语言模型: ${selected.fullName}`);
                const options = {
                    ...selected.options,
                    messages,
                    tools: execution.wrap(tools),
                    toolChoice: "required" as const,
                    maxSteps: 1,
                    abortSignal: signal,
                };
                let fullText = "";
                let usage: { prompt_tokens: number; completion_tokens: number } | undefined;
                if (this.config.stream) {
                    let firstTokenReceived = false;
                    const receiveFirstToken = () => {
                        if (firstTokenReceived)
                            return;
                        firstTokenReceived = true;
                        clearTimeout(firstTokenTimeout);
                        this.logger.info("流式响应已开始接收");
                    };
                    firstTokenTimeout = setTimeout(() => controller.abort("首字响应超时"), this.config.switchConfig.firstToken);
                    const streaming = streamText({
                        ...options,
                        onEvent: (event) => {
                            if ((event.type === "text-delta" || event.type === "reasoning-delta") && isNotEmpty(event.text))
                                receiveFirstToken();
                            if (event.type === "tool-call-streaming-start" || event.type === "tool-call-delta")
                                receiveFirstToken();
                        },
                    });
                    // 先处理所有异步结果的拒绝，防止读取正文失败后遗留未处理异常。
                    void streaming.steps.catch(() => {});
                    void streaming.usage.catch(() => {});
                    void streaming.totalUsage.catch(() => {});
                    void streaming.messages.catch(() => {});
                    for await (const chunk of streaming.textStream)
                        fullText += chunk;
                    await streaming.steps;
                    usage = await streaming.totalUsage;
                }
                else {
                    // xsai 的非流式流程会自行请求下一步；每轮交由框架构建上下文并控制上限。
                    try {
                        await generateText({
                            ...options,
                            onStepFinish: (step) => { throw new HeartbeatStepComplete(step); },
                        });
                    } catch (error) {
                        if (!(error instanceof HeartbeatStepComplete))
                            throw error;
                        fullText = error.step.text ?? "";
                        usage = error.step.usage;
                    }
                }
                await execution.executePending();
                await execution.drain();
                let requestHeartbeat = false;
                // 有原生调用时不再解析正文中的动作，避免同一操作执行两次。
                if (!execution.started) {
                    const { data, error } = new JsonParser<AgentResponse>().parse(fullText);
                    if (error || !data || !Array.isArray(data.actions))
                        throw new Error("Invalid LLM response format");
                    for (const action of data.actions) {
                        if (!action || typeof action.name !== "string" || !action.name)
                            throw new Error("Invalid action name");
                        if (action.params != null && (typeof action.params !== "object" || Array.isArray(action.params)))
                            throw new Error("Invalid action parameters");
                        await execution.enqueue(action.name, action.params ?? {});
                    }
                    requestHeartbeat = data.request_heartbeat === true;
                }
                const promptTokens = usage?.prompt_tokens ?? `~${estimateTokensByRegex(messages.map(m => m.content).join())}`;
                const completionTokens = usage?.completion_tokens ?? `~${estimateTokensByRegex(fullText)}`;
                this.logger.info(`💰 Token 消耗 | 输入: ${promptTokens} | 输出: ${completionTokens} | 耗时: ${Date.now() - startTime}ms`);
                this.modelSwitcher.recordResult(selected.fullName, true, undefined, Date.now() - startTime);
                await this.horizon.events.markAsActive(percept.scope, new Date());
                return { continue: !execution.hasAction && (execution.hasTool || requestHeartbeat), success: true };
            } catch (error) {
                controller.abort();
                // 等待已开始的工具结束，频道锁不能先于实际操作释放。
                await execution.drain().catch(() => {});
                this.logger.error(`调用大语言模型失败: ${error instanceof Error ? error.message : String(error)}`);
                this.modelSwitcher.recordResult(selected.fullName, false, ModelError.classify(error), Date.now() - startTime);
                attempt++;
                if (execution.started || attempt >= this.config.switchConfig.maxRetries)
                    return { continue: false, success: false };
            } finally {
                clearTimeout(firstTokenTimeout);
            }
        }
    }
}

function _toString(obj) {
    if (typeof obj === "string")
        return obj;
    return JSON.stringify(obj);
}

/** 用步骤结果结束 SDK 内部循环，后续心跳由 runCycle 调度。 */
class HeartbeatStepComplete extends Error {
    constructor(public readonly step: CompletionStep) {
        super("Heartbeat step complete");
    }
}

interface AgentResponse {
    actions: Array<{
        name: string;
        params?: Record<string, any>;
    }>;
    request_heartbeat: boolean;
}
