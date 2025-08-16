import { Context, Service, Session } from "koishi";

import { ChatModelSwitcher, ModelService, TaskType } from "@/services/model";
import { loadTemplate, PromptService } from "@/services/prompt";
import { AgentStimulus } from "@/services/worldstate";
import { WorldStateService } from "@/services/worldstate/index";
import { Services } from "@/shared/constants";
import { AppError, handleError } from "@/shared/errors";
import { ErrorDefinitions } from "@/shared/errors/definitions";
import { AgentBehaviorConfig } from "./config";
import { PromptContextBuilder } from "./ContextBuilder";
import { HeartbeatProcessor } from "./HeartbeatProcessor";
import { StimulusScheduler } from "./StimulusScheduler";
import { WillingnessManager } from "./willing";

declare module "koishi" {
    interface Events {
        "after-send": (session: Session) => void;
    }
}

/**
 * @description 智能体核心服务 (AgentCore)。
 * 作为协调器，它初始化并连接各个子系统：意愿、调度、上下文构建和心跳处理。
 * 它监听外部刺激，并将其委托给调度器进行处理。
 */
export class AgentCore extends Service<AgentBehaviorConfig> {
    static readonly inject = [
        Services.Asset,
        Services.Logger,
        Services.Memory,
        Services.Model,
        Services.Prompt,
        Services.Tool,
        Services.WorldState,
    ];

    // 依赖的服务
    private readonly worldState: WorldStateService;
    private readonly modelService: ModelService;
    private readonly promptService: PromptService;

    // 核心组件
    private willing: WillingnessManager;
    private scheduler: StimulusScheduler;
    private contextBuilder: PromptContextBuilder;
    private processor: HeartbeatProcessor;

    private modelSwitcher: ChatModelSwitcher;

    constructor(ctx: Context, config: AgentBehaviorConfig) {
        super(ctx, "agent", true);
        this.config = config;
        this.logger = ctx[Services.Logger].getLogger("[智能体核心]");

        // 1. 获取依赖服务
        this.worldState = this.ctx[Services.WorldState];
        this.modelService = this.ctx[Services.Model];
        this.promptService = this.ctx[Services.Prompt];

        // 2. 初始化核心组件
        this.modelSwitcher = this.modelService.useChatGroup(TaskType.Chat);
        if (!this.modelSwitcher) {
            // 使用新的、声明式的错误
            const error = new AppError(ErrorDefinitions.CONFIG.MISSING_MODEL_GROUP, {
                context: { service: "AgentCore", component: "modelSwitcher" },
            });
            // handleError 会自动格式化和记录
            handleError(this.logger, error, "AgentCore startup check");
            // 这里可以考虑抛出错误让上层服务停止
            throw error;
        }

        this.willing = new WillingnessManager(ctx, config.willingness);

        // 实例化新的辅助类
        this.contextBuilder = new PromptContextBuilder(ctx, config, this.modelSwitcher);
        this.processor = new HeartbeatProcessor(
            ctx,
            config,
            this.modelSwitcher,
            ctx[Services.Prompt],
            ctx[Services.Tool],
            this.worldState.l1_manager,
            this.contextBuilder
        );

        // 创建调度器，并传入核心处理逻辑 (processor.runCycle) 作为回调
        this.scheduler = new StimulusScheduler(ctx, config, async (stimulus) => {
            const { channelCid } = stimulus;

            // 在任务开始前，执行预回复操作（可能会有衰减）
            this.willing.handlePreReply(channelCid);

            // 运行核心心跳循环
            const success = await this.processor.runCycle(stimulus);

            // [日志添加] 如果成功回复，记录意愿值的激励变化
            if (success) {
                // 捕获激励前的意愿值
                const willingnessBeforeReply = this.willing.getCurrentWillingness(channelCid);
                // 执行激励
                this.willing.handlePostReply(stimulus.session, channelCid);
                // 捕获激励后的意愿值
                const willingnessAfterReply = this.willing.getCurrentWillingness(channelCid);

                /* prettier-ignore */
                this.logger.debug(`[${channelCid}] 回复成功，意愿值已更新: ${willingnessBeforeReply.toFixed(2)} -> ${willingnessAfterReply.toFixed(2)}`);
            }
        });
    }

    protected async start(): Promise<void> {
        this._registerPromptTemplates();

        this.ctx.on("agent/stimulus", (stimulus: AgentStimulus<any>) => {
            const { type, channelCid, session } = stimulus;

            let decision = false;

            if (type === "user_message") {
                try {
                    const willingnessBefore = this.willing.getCurrentWillingness(channelCid);
                    const result = this.willing.shouldReply(session);
                    const willingnessAfter = this.willing.getCurrentWillingness(channelCid); // 获取衰减后的值
                    decision = result.decision;

                    /* prettier-ignore */
                    this.logger.debug(`[${channelCid}] 意愿计算: ${willingnessBefore.toFixed(2)} -> ${willingnessAfter.toFixed(2)} | 回复概率: ${(result.probability * 100).toFixed(1)}% | 初步决策: ${decision}`);
                } catch (error) {
                    handleError(
                        this.logger,
                        new AppError(ErrorDefinitions.WILLINGNESS.CALCULATION_FAILED, {
                            cause: error as Error,
                            context: { channelCid },
                        }),
                        `Willingness calculation (Channel: ${channelCid})`
                    );
                    return; // 出现错误时终止处理
                }
            } else {
                // 对于系统事件等高优先级刺激，直接决定响应
                decision = true;
                this.logger.info(`[${channelCid}] 接收到系统刺激 [${type}]，自动触发响应。`);
            }

            if (!decision) {
                //this.logger.debug(`[${channelCid}] 意愿计算决策为：跳过`);
                return;
            }

            // 2. 禁言检查
            if (this.worldState.isBotMuted(channelCid)) {
                this.logger.warn(`[${channelCid}] 机器人已被禁言，响应终止。`);
                return;
            }

            // 3. 委托给调度器
            // this.logger.info(`[${channelCid}] 刺激 [${type}] 通过意愿检查，移交调度器处理。`);
            this.scheduler.schedule(stimulus);
        });

        this.willing.startDecayCycle();
        //this.logger.info("服务已启动，并开始监听刺激。");
    }

    protected stop(): void {
        this.scheduler.dispose();
        this.willing.stopDecayCycle();
        this.logger.info("服务已停止。");
    }

    private _registerPromptTemplates(): void {
        // this.logger.info("正在注册提示词模板");

        // 注册所有可重用的局部模板
        this.promptService.registerTemplate("agent.partial.world_state", loadTemplate("world_state"));
        this.promptService.registerTemplate("agent.partial.l1_history_item", loadTemplate("l1_history_item"));

        // 注册主模板
        this.promptService.registerTemplate("agent.system", this.config.prompt.systemTemplate);
        this.promptService.registerTemplate("agent.user", this.config.prompt.userTemplate);

        // 注册动态片段
        this.promptService.registerSnippet("agent.context.currentTime", () => new Date().toISOString());
    }
}
