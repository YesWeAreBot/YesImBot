import { readFileSync } from "fs";
import { Context, h, Logger, Random, Service, Session } from "koishi";
import path from "path";
import type { ImagePart, Message, TextPart } from "xsai";

import { Properties, ToolSchema, ToolService } from "@/services/extension";
import { MemoryBlockData } from "@/services/memory";
import { IChatModel, ModelService, ModelSwitcher, TaskType } from "@/services/model";
import { PromptService } from "@/services/prompt";
import { Services } from "@/services/types";
import { AgentResponse, WorldState, WorldStateService } from "@/services/worldstate";
import { TEMPLATES_DIR } from "@/shared/constants";
import { estimateTokensByRegex, JsonParser, truncate } from "@/shared/utils";
import { AgentBehaviorConfig, MultiModalSystemBaseTemplate } from "./config";
import { WillingnessManager } from "./willing";

declare module "koishi" {
    interface Events {
        "after-send": (session: Session) => void;
    }
}

type WithDispose<T> = T & { dispose: () => void };

// 定义 PromptBuilder 需要的完整上下文
export interface PromptContext {
    toolSchemas: ToolSchema[];
    memory: {
        lastModified: string;
        archivalCount: number;
        memoryBlocks: MemoryBlockData[];
    };
    worldState: WorldState; // 世界状态快照
    previousResponses: AgentResponse[]; // Agent 最近的回合历史
    multiModalData: {
        images: (ImagePart | TextPart)[];
    };
    onetimeCode: string;
}

// 用于多模态上下文筛选的内部类型
interface ImageCandidate {
    id: string;
    timestamp: number;
    priority: number;
}

export class AgentCore extends Service<AgentBehaviorConfig> {
    static readonly inject = [
        Services.WorldState,
        Services.Model,
        Services.Tool,
        Services.Memory,
        Services.Image,
        Services.Logger,
        Services.Prompt,
    ];

    // 依赖的服务
    private readonly worldState: WorldStateService;
    private readonly modelService: ModelService;
    private readonly toolService: ToolService;
    private readonly promptService: PromptService;

    // 内部组件
    private readonly _logger: Logger;

    private readonly parser: JsonParser<AgentResponse>;
    private readonly modelSwitcher: ModelSwitcher<IChatModel>;
    private readonly willing: WillingnessManager;

    // 内部状态
    private readonly allowedChannels = new Set<string>();
    private willingnessDecayTimer: NodeJS.Timeout;
    private readonly debouncedReplyTasks: Map<string, WithDispose<(sid: string) => void>> = new Map();

    private runningTasks: Set<string> = new Set();

    private imageLifecycleTracker = new Map<string, number>();

    constructor(ctx: Context, config: AgentBehaviorConfig) {
        super(ctx, "agent", true);
        this.ctx = ctx;
        this.config = config;
        this._logger = ctx[Services.Logger].getLogger("[智能体核心]");

        this.worldState = this.ctx[Services.WorldState];
        this.modelService = this.ctx[Services.Model];
        this.toolService = this.ctx[Services.Tool];
        this.promptService = this.ctx[Services.Prompt];

        // 实例化内部组件

        this.parser = new JsonParser<AgentResponse>();
        this.modelSwitcher = this.modelService.useChatGroup(TaskType.Chat);
        this.willing = new WillingnessManager(this.ctx, this.config.willingness);
    }

    protected async start(): Promise<void> {
        this._registerPromptTemplates();
        this.updateAllowedChannels();
        this.ctx.on("config", () => this.updateAllowedChannels());

        this.ctx.on("worldstate:segment-updated", async (session, sid) => {
            const channelKey = session.cid;

            // --- 第1步: 意愿计算与决策 (无论如何都执行) ---
            // 这个阶段不应被任何锁阻止，以确保意愿可以持续更新。
            let decision = false;
            let probability = 0;
            try {
                const currentWillingnessBefore = this.willing.getCurrentWillingness(channelKey);
                // 调用 shouldReply 来计算和更新意愿值，并获得初步决策
                const result = this.willing.shouldReply(session);
                decision = result.decision;
                probability = result.probability;
                const currentWillingnessAfter = this.willing.getCurrentWillingness(channelKey);

                /* prettier-ignore */
                this._logger.debug(`[${channelKey}] 意愿计算: ${currentWillingnessBefore.toFixed(2)} -> ${currentWillingnessAfter.toFixed(2)} | 回复概率: ${(probability * 100).toFixed(1)}% | 初步决策: ${decision}`);
            } catch (error) {
                // 意愿计算阶段的错误也需要捕获
                this.handleError(error, `意愿计算失败 (Channel: ${channelKey})`);
                return; // 计算失败，直接退出
            }

            // --- 第2步: 检查决策并触发防抖任务 ---
            if (!decision) {
                // 如果决策为不回复，则流程到此结束。
                //this._logger.debug(`[${channelKey}] 决策为不回复，任务终止。`);
                return;
            }

            if (this.runningTasks.has(channelKey)) {
                this._logger.warn(`[${channelKey}] 决策为回复，但发现已有任务在运行。本次执行被跳过。`);
                return;
            }
            // 从 Map 中获取或创建当前频道的防抖函数
            let debouncedTask = this.debouncedReplyTasks.get(channelKey);

            if (!debouncedTask) {
                // 如果该频道还没有对应的防杜函数，则创建一个
                // ctx.debounce 的回调函数包含了原先需要被保护的“第3步”逻辑
                debouncedTask = this.ctx.debounce(async (sid) => {
                    // --- 第3步: 执行回复任务 (加锁 -> 执行 -> 解锁) ---
                    // 防抖成功后，这里的代码才会被执行
                    try {
                        // --- 加锁 ---
                        this.runningTasks.add(channelKey);
                        this._logger.debug(`[${channelKey}] 锁定频道并开始执行回复任务。`);

                        // 执行行动前钩子
                        this.willing.handlePreReply(channelKey);

                        // 核心循环
                        const success = await this.runAgentCycle(session, sid);

                        // 行动后钩子 (只在成功时调用)
                        if (success) {
                            const willingnessBeforeReply = this.willing.getCurrentWillingness(channelKey);
                            this.willing.handlePostReply(channelKey);
                            const willingnessAfterReply = this.willing.getCurrentWillingness(channelKey);
                            /* prettier-ignore */
                            this._logger.debug(`[${channelKey}] 回复成功，意愿值已更新: ${willingnessBeforeReply.toFixed(2)} -> ${willingnessAfterReply.toFixed(2)}`);
                        }
                        // this._logger.debug(`[${channelKey}] 回复任务执行完毕。`);
                    } catch (error) {
                        // 捕获 runAgentCycle 或钩子函数中的任何错误
                        /* prettier-ignore */
                        this.handleError(error, `执行回复任务时发生错误 (Channel: ${channelKey}, Segment ID: ${sid})`);
                    } finally {
                        // --- 解锁 ---
                        // 无论成功还是失败，都必须在 finally 块中释放锁
                        this.runningTasks.delete(channelKey);
                        this._logger.debug(`[${channelKey}] 频道锁已释放。`);
                    }
                }, this.config.arousal.debounceMs); // 使用定义的延迟

                // 将新创建的防抖函数存入 Map
                this.debouncedReplyTasks.set(channelKey, debouncedTask);
            }

            // 触发防抖流程
            // 每次调用都会重置计时器。只有当 DEBOUNCE_DELAY 毫秒内没有新的调用时，上面的回调才会执行。
            /* prettier-ignore */
            this._logger.debug(`[${channelKey}] 决策为回复，触发防抖机制（延迟 ${this.config.arousal.debounceMs}ms）。`);
            debouncedTask(sid);
        });

        this.willing.startDecayCycle();

        this._logger.info("服务已启动");
    }

    protected stop(): void {
        this.debouncedReplyTasks.forEach((d) => d.dispose());
        clearInterval(this.willingnessDecayTimer);
        this.willing.stopDecayCycle();
        this._logger.info("服务已停止");
    }

    private updateAllowedChannels(): void {
        this.allowedChannels.clear();
        this.config.arousal.allowedChannelGroups.forEach((group) => {
            group.forEach(({ platform, id }) => {
                this.allowedChannels.add(`${platform}:${id}`);
            });
        });
        // this._logger.debug(`⚙️ 监听频道已更新 | 总数: ${this.allowedChannels.size}`);
    }

    private _registerPromptTemplates(): void {
        this._logger.info("⚙️ 正在注册提示词模板...");

        const loadTemplate = (name: string, ext: string = "mustache") => {
            try {
                const fullPath = path.resolve(TEMPLATES_DIR, `${name}.${ext}`);
                return readFileSync(fullPath, "utf-8");
            } catch (error) {
                this._logger.error(`加载模板失败 "${name}.${ext}": ${error.message}`);
                // 返回一个包含错误信息的模板，便于调试
                return `{{! Error loading template: ${name} }}`;
            }
        };

        // 注册所有可重用的局部模板 (Partials)
        // 使用 Mustache 的 {{> partialName }} 语法来引用它们
        this.promptService.registerTemplate("agent.partial.core_memory", loadTemplate("core_memory"));
        this.promptService.registerTemplate("agent.partial.tool_definition", loadTemplate("tool_definition"));
        this.promptService.registerTemplate("agent.partial.world_state", loadTemplate("world_state"));
        this.promptService.registerTemplate("agent.partial.current_turn_history", loadTemplate("current_turn_history"));

        // 注册主模板
        // 注意：现在模板文件本身需要包含对 partials 的引用
        this.promptService.registerTemplate("agent.system", this.config.prompt.systemTemplate);
        this.promptService.registerTemplate("agent.user", this.config.prompt.userTemplate);

        // 注册动态片段 (Snippets) - 如果有的话
        // 示例：注册一个提供当前时间的片段
        this.promptService.registerSnippet("agent.context.currentTime", () => new Date().toISOString());

        // 注意：像 toolSchemas, memory, worldState 这些数据，因为每次调用都会重新生成，
        // 所以更适合作为 render 方法的 initialScope 传入，而不是注册为全局 Snippet。
        // 这使得每次渲染的上下文都是隔离和最新的。

        this._logger.info("✅ 提示词模板注册完成。");
    }

    /**
     * Agent 的核心心跳循环。现在只负责控制循环流程。
     */
    private async runAgentCycle(session: Session, sid: string): Promise<boolean> {
        const collectedResponses: AgentResponse[] = [];
        let shouldContinueHeartbeat = true;
        let heartbeatCount = 0;
        let success = false;

        while (shouldContinueHeartbeat && heartbeatCount < this.config.heartbeat) {
            heartbeatCount++;
            try {
                const result = await this._performSingleHeartbeat(session, sid, collectedResponses);
                if (result) {
                    collectedResponses.push(result.response);
                    shouldContinueHeartbeat = result.continue;
                    success = true; // 至少成功一次心跳
                } else {
                    shouldContinueHeartbeat = false;
                }
            } catch (error) {
                this.handleError(error, `心跳 #${heartbeatCount} 期间 (段落ID: ${sid})`);
                shouldContinueHeartbeat = false;
                success = false; // 出错则认为本次循环失败
            }
        }

        if (collectedResponses.length > 0) {
            await this.worldState.recordAgentTurn(sid, collectedResponses);
        }

        return success;
    }

    /**
     * 执行单次心跳的完整逻辑。
     * @returns 返回包含响应和是否继续的标志，或在失败时返回 null。
     */
    private async _performSingleHeartbeat(
        session: Session,
        sid: string,
        previousResponses: AgentResponse[]
    ): Promise<{ response: AgentResponse; continue: boolean } | null> {
        // 1. 构建提示词所需的所有上下文信息
        const promptContext = await this.buildPromptContext(session, sid, previousResponses);

        // 2. 准备模板渲染所需的数据视图 (View)
        const view = {
            session,
            TOOL_DEFINITION: { tools: prepareDataForTemplate(promptContext.toolSchemas) },
            CORE_MEMORY: promptContext.memory,
            WORLD_STATE: promptContext.worldState,
            CURRENT_CONVERSATION: previousResponses.length > 0 ? { history: previousResponses } : null,
            ONETIME_CODE: promptContext.onetimeCode,
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

        // 3. 渲染提示词并选择模型
        const systemPrompt = await this.promptService.render("agent.system", view);
        const userPromptText = await this.promptService.render("agent.user", view);

        let chatModel: IChatModel;
        let userMessageContent: string | (ImagePart | TextPart)[];

        const hasImages = promptContext.multiModalData.images.length > 0;
        if (hasImages) {
            // 寻找支持多模态的模型，如果找不到则降级
            const visionModel = this.modelSwitcher.models.find((m) => m.isVisionModel());
            if (visionModel) {
                chatModel = visionModel;
                const multiModalPreamble = MultiModalSystemBaseTemplate.replace(
                    "{{ ONETIME_CODE }}",
                    promptContext.onetimeCode
                );
                userMessageContent = [
                    { type: "text", text: multiModalPreamble },
                    ...promptContext.multiModalData.images,
                    { type: "text", text: userPromptText },
                ];
            } else {
                this._logger.warn(`上下文包含图片，但当前模型组中没有支持多模态的模型。将忽略图片。`);
                chatModel = this.modelSwitcher.next(); // 使用默认轮询模型
                userMessageContent = userPromptText;
            }
        } else {
            chatModel = this.modelSwitcher.next();
            userMessageContent = userPromptText;
        }

        if (!chatModel) {
            this._logger.error(`✖ 模型未找到，停止回复 | 频道 - ${session.cid}`);
            return null;
        }

        const messages: Message[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessageContent },
        ];

        // 4. 调用 LLM
        const stime = Date.now();
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), this.config.timeout * 1000);

        const llmRawResponse = await chatModel.chat(messages, {
            abortSignal: abortController.signal,
            onStreamStart: () => clearTimeout(timeout),
        });
        this._logger.info(`💬 响应时间: ${Date.now() - stime}ms`);
        const prompt_tokens = llmRawResponse.usage?.prompt_tokens || estimateTokensByRegex(systemPrompt + userPromptText);
        const completion_tokens = llmRawResponse.usage?.completion_tokens || estimateTokensByRegex(llmRawResponse.text);
        /* prettier-ignore */
        this._logger.info(`💰 Token 消耗 | 输入: ${prompt_tokens} | 输出: ${completion_tokens}`);

        // 5. 解析和处理响应
        const llmParsedResponse = this.parser.parse(llmRawResponse.text);
        if (llmParsedResponse.error || !llmParsedResponse.data) {
            /* prettier-ignore */
            this._logger.warn(`✖ 解析失败 | 错误: ${llmParsedResponse.error} | 原始响应: ${truncate(llmRawResponse.text, 100).replace(/\n/g, " ")}`);
            return null;
        }

        const agentResponseData = llmParsedResponse.data;
        if (!Array.isArray(agentResponseData.actions)) {
            this._logger.warn(`✖ 格式无效 | actions应为数组，实际为 ${typeof agentResponseData.actions}`);
            return null;
        }

        if (agentResponseData.thoughts) {
            this.displayThoughts(agentResponseData.thoughts);
        }

        const observations = await this.executeActions(session, agentResponseData.actions);
        const fullResponse: AgentResponse = { ...agentResponseData, observations };

        return { response: fullResponse, continue: agentResponseData.request_heartbeat };
    }

    private displayThoughts(thoughts: AgentResponse["thoughts"]) {
        const { observe, analyze_infer, plan } = thoughts;
        this._logger.info(`
[观察] ${observe}
[分析] ${analyze_infer}
[计划] ${plan}`);
    }

    private async executeActions(
        session: Session,
        actions: AgentResponse["actions"]
    ): Promise<AgentResponse["observations"]> {
        const observations: AgentResponse["observations"] = [];
        for await (const action of actions) {
            const result = await this.toolService.invoke(action.function, action.params, session);
            observations.push({
                function: action.function,
                status: result.status,
                result: result.result,
                error: result.error,
            });
        }
        return observations;
    }

    /**
     * 构建用于生成提示词的完整上下文。
     * 此函数现在是一个纯数据聚合器，不产生副作用。
     * @param session 当前会话
     * @param sid 当前处理的段落ID
     * @param previousResponses 在当前agent回合中，之前心跳的响应
     * @returns {Promise<PromptContext>} 完整的提示词上下文对象
     */
    private async buildPromptContext(
        session: Session,
        sid: string,
        previousResponses: AgentResponse[]
    ): Promise<PromptContext> {
        const onetimeCode = Random.id(8);

        // 1. 获取世界状态快照
        const worldState = await this.worldState.getWorldState(session, onetimeCode);
        // 注意：之前在这里添加的 `is_current` 标记已被移除。
        // 这种展示逻辑应由模板本身处理，例如通过比较 message.id 和 worldState.channel.history.pending.id。
        // 这使得此函数更加纯粹，只负责数据聚合。

        // 2. 获取多模态上下文（如果启用）
        const multiModalContent = this.config.vision.enabled
            ? await this.buildMultimodalContext(worldState)
            : { images: [] };

        // 3. 聚合所有数据
        return {
            toolSchemas: this.toolService.getToolSchemas(),
            memory: await this.ctx[Services.Memory].getMemoryDataForRendering(),
            worldState: worldState,
            previousResponses: previousResponses,
            multiModalData: {
                images: multiModalContent.images,
            },
            onetimeCode,
        };
    }

    /**
     * @description 构建多模态上下文。
     * 采用更声明式的方法来智能筛选图片，提高可读性和可维护性。
     * @param worldState 当前的世界状态
     * @returns 包含筛选后的图片内容的对象
     */
    private async buildMultimodalContext(worldState: WorldState): Promise<{ images: (ImagePart | TextPart)[] }> {
        // 1. 将所有消息扁平化并建立索引
        const allSegments = [
            worldState.channel.history.pending,
            ...(worldState.channel.history.closed || []),
            ...(worldState.channel.history.folded ? [worldState.channel.history.folded] : []),
        ].filter(Boolean); // 过滤掉可能为null的项

        const allMessages = allSegments.flatMap((s) => s.dialogue);
        const messageMap = new Map(allMessages.map((m) => [m.id, m]));

        // 2. 收集所有潜在的图片候选者，并赋予优先级
        const imageCandidates = allMessages.flatMap((msg) => {
            const elements = h.parse(msg.content);
            const imageIds = elements.filter((e) => e.type === "image" && e.attrs.id).map((e) => e.attrs.id as string);

            // 检查引用，为被引用的图片赋予更高优先级
            let isQuotedImage = false;
            if (msg.quoteId && messageMap.has(msg.quoteId)) {
                const quotedElements = h.parse(messageMap.get(msg.quoteId).content);
                if (quotedElements.some((e) => e.type === "image")) {
                    isQuotedImage = true;
                }
            }

            return imageIds.map((id) => ({
                id,
                timestamp: msg.timestamp.getTime(),
                priority: isQuotedImage ? 1 : 0, // 1 for quoted, 0 for regular
            }));
        });

        // 3. 对候选图片进行排序：优先级更高 -> 时间戳更新 -> 去重和筛选
        const sortedUniqueCandidates = Array.from(
            imageCandidates
                .sort((a, b) => b.priority - a.priority || b.timestamp - a.timestamp)
                .reduce((map, candidate) => {
                    // 保留每个ID最高优先级的候选项
                    if (!map.has(candidate.id)) {
                        map.set(candidate.id, candidate);
                    }
                    return map;
                }, new Map<string, ImageCandidate>())
                .values()
        );

        // 4. 根据生命周期和数量上限选择最终图片
        const finalImageIds = new Set<string>();
        for (const candidate of sortedUniqueCandidates) {
            if (finalImageIds.size >= this.config.vision.maxImagesInContext) break;

            const usageCount = this.imageLifecycleTracker.get(candidate.id) || 0;
            if (usageCount < this.config.vision.imageLifecycleCount) {
                finalImageIds.add(candidate.id);
                this.imageLifecycleTracker.set(candidate.id, usageCount + 1);
            }
        }

        // 5. 获取图片数据并格式化输出
        if (finalImageIds.size === 0) {
            return { images: [] };
        }

        const imageService = this.ctx[Services.Image];
        const imageDataResults = await Promise.all(
            Array.from(finalImageIds).map((id) => imageService.getImageDataWithContent(id))
        );

        const finalImages: (ImagePart | TextPart)[] = [];
        const allowedImageTypes = new Set(this.config.vision.allowedImageTypes);

        for (const result of imageDataResults) {
            if (result && result.data && allowedImageTypes.has(result.data.mimeType)) {
                // 为LLM提供更明确的图片标识
                finalImages.push({ type: "text", text: `The following is an image with ID #${result.data.id}:` });
                finalImages.push({
                    type: "image_url",
                    image_url: { url: result.content, detail: this.config.vision.detail },
                });
            }
        }

        return { images: finalImages };
    }

    private handleError(error: any, contextDescription: string): void {
        if (error instanceof Error) {
            /* prettier-ignore */
            this._logger.error(`[错误] ${contextDescription}\n` + `错误信息: ${error.message}\n` + `堆栈追踪:\n${error.stack}`);
        } else {
            // 如果捕获到的不是标准Error对象（例如字符串或普通对象）
            this._logger.error(`[错误] ${contextDescription}\n` + `捕获到非标准错误: ${JSON.stringify(error)}`);
        }
    }
}

function _toString(obj) {
    if (typeof obj === "string") return obj;
    return JSON.stringify(obj);
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
