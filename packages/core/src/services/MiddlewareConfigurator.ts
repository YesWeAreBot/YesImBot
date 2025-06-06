import { Context } from "koishi";
import { ChatModelSwitcher } from "../adapters";
import { Config } from "../config";
import { MiddlewareManager } from "../middleware/base";
import { CheckReplyConditionMiddleware } from "../middleware/CheckReplyCondition";
import { DatabaseStorageMiddleware } from "../middleware/DatabaseStorage";
import { ErrorHandlingMiddleware } from "../middleware/ErrorHandling";
import { LLMProcessingMiddleware } from "../middleware/LLMProcessing";
import { ResponseHandlingMiddleware } from "../middleware/ResponseHandling";
import { PromptBuilder } from "../prompt/PromptBuilder";
import { ImageProcessor } from "../utils";
import { ScenarioManager } from "./ScenarioManager";
import { IServiceContainer, SERVICE_TOKENS } from "./ServiceContainer";

/**
 * 中间件配置器
 * 负责配置和组装中间件链
 */
export class MiddlewareConfigurator {
    private controller = new AbortController();

    constructor(private ctx: Context, private config: Config, private container: IServiceContainer) {}

    /**
     * 配置中间件链
     */
    public configure(): MiddlewareManager {
        const middlewareManager = this.container.get<MiddlewareManager>(SERVICE_TOKENS.MIDDLEWARE_MANAGER);

        this.setupMiddlewareChain(middlewareManager);
        this.registerEventHandlers();
        this.registerCleanupHandlers();

        return middlewareManager;
    }

    private setupMiddlewareChain(middlewareManager: MiddlewareManager): void {
        // 错误处理中间件
        middlewareManager.use(
            new ErrorHandlingMiddleware(this.ctx, {
                debug: this.config.Debug.EnableDebug,
                uploadDump: this.config.Debug.UploadDump,
                pasteServiceUrl: "https://dump.yesimbot.chat/",
                includeFullSessionContent: false,
            })
        );

        // 数据库存储中间件
        const imageProcessor = this.container.get<ImageProcessor>(SERVICE_TOKENS.IMAGE_PROCESSOR);
        const scenarioManager = this.container.get<ScenarioManager>(SERVICE_TOKENS.SCENARIO_MANAGER);

        middlewareManager.use(
            new DatabaseStorageMiddleware(this.ctx, {
                imageProcessor,
                scenarioManager,
            })
        );

        // 检查回复条件中间件
        const checkReplyMiddleware = new CheckReplyConditionMiddleware(this.ctx, {
            allowedChannels: this.config.MemorySlot.SlotContains,
            testMode: this.config.Debug.TestMode,
            atReactPossibility: this.config.MemorySlot.AtReactPossibility,
            increaseWillingnessOn: {
                message: this.config.MemorySlot.IncreaseWillingnessOn.Message,
                at: this.config.MemorySlot.IncreaseWillingnessOn.At,
            },
            threshold: this.config.MemorySlot.Threshold,
            messageWaitTime: this.config.MemorySlot.MessageWaitTime,
            sameUserThreshold: this.config.MemorySlot.SameUserThreshold,
        });
        middlewareManager.use(checkReplyMiddleware);

        // LLM处理中间件
        const chatModelSwitcher = this.container.get<ChatModelSwitcher>(SERVICE_TOKENS.CHAT_MODEL_SWITCHER);
        const promptBuilder = this.container.get<PromptBuilder>(SERVICE_TOKENS.PROMPT_BUILDER);

        middlewareManager.use(
            new LLMProcessingMiddleware(
                this.ctx,
                {
                    chatModelSwitcher,
                    promptBuilder,
                    scenarioManager,
                },
                {
                    debug: this.config.Debug.EnableDebug,
                    abortSignal: this.controller.signal,
                    slotContains: this.config.MemorySlot.SlotContains,
                    slotSize: this.config.MemorySlot.SlotSize,
                }
            )
        );

        // 响应处理中间件
        middlewareManager.use(
            new ResponseHandlingMiddleware(
                this.ctx,
                { middlewareManager, scenarioManager },
                {
                    maxRetry: this.config.ToolCall.MaxRetry,
                    life: this.config.ToolCall.Life,
                    maxHeartbeat: this.config.Chat.MaxHeartbeat,
                }
            )
        );
    }

    private registerEventHandlers(): void {
        // 注册频道状态释放事件
        this.ctx.on("channel:processing:release", (channelId: string) => {
            const middlewareManager = this.container.get<MiddlewareManager>(SERVICE_TOKENS.MIDDLEWARE_MANAGER);
            const checkReply = middlewareManager.getMiddleware<CheckReplyConditionMiddleware>("check-reply-condition");
            if (checkReply) {
                checkReply.releaseChannelState(channelId);
            }
        });
    }

    private registerCleanupHandlers(): void {
        this.ctx.on("dispose", () => {
            this.controller.abort();

            const scenarioManager = this.container.get<ScenarioManager>(SERVICE_TOKENS.SCENARIO_MANAGER);
            scenarioManager.clearAllScenario();

            const middlewareManager = this.container.get<MiddlewareManager>(SERVICE_TOKENS.MIDDLEWARE_MANAGER);
            const checkReply = middlewareManager.getMiddleware<CheckReplyConditionMiddleware>("check-reply-condition");
            if (checkReply) {
                checkReply.destroy();
            }
        });
    }

    public dispose(): void {
        this.controller.abort();
    }
}
