import { Context, Service, Session } from "koishi";

import { ChatModelSwitcher, ModelService, TaskType } from "@/services/model";
import { loadTemplate, PromptService } from "@/services/prompt";
import { AgentStimulus } from "@/services/worldstate";
import { WorldStateService } from "@/services/worldstate/index";
import { Services } from "@/shared/constants";
import { AppError, handleError } from "@/shared/errors";
import { ErrorDefinitions } from "@/shared/errors/definitions";
import { AgentBehaviorConfig } from "./config";
import { PromptContextBuilder } from "./context-builder";
import { HeartbeatProcessor } from "./heartbeat-processor";
import { StimulusScheduler } from "./scheduler";
import { WillingnessManager } from "./willing";

declare module "koishi" {
    interface Events {
        "after-send": (session: Session) => void;
    }
}

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
        super(ctx, Services.Agent, true);
        this.config = config;
        this.logger = ctx[Services.Logger].getLogger("[智能体核心]");

        this.worldState = this.ctx[Services.WorldState];
        this.modelService = this.ctx[Services.Model];
        this.promptService = this.ctx[Services.Prompt];

        this.modelSwitcher = this.modelService.useChatGroup(TaskType.Chat);
        if (!this.modelSwitcher) {
            const error = new AppError(ErrorDefinitions.CONFIG.MISSING_MODEL_GROUP, {
                context: { service: "AgentCore", component: "modelSwitcher" },
            });
            handleError(this.logger, error, "AgentCore startup check");
            throw error;
        }

        this.willing = new WillingnessManager(ctx, config.willingness);

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

        this.scheduler = new StimulusScheduler(ctx, config, async (stimulus) => {
            const { channelCid } = stimulus;

            this.willing.handlePreReply(channelCid);

            const success = await this.processor.runCycle(stimulus);

            if (success) {
                const willingnessBeforeReply = this.willing.getCurrentWillingness(channelCid);
                this.willing.handlePostReply(stimulus.session, channelCid);
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
                    return;
                }
            } else {
                decision = true;
                this.logger.info(`[${channelCid}] 接收到系统刺激 [${type}]，自动触发响应。`);
            }

            if (!decision) {
                return;
            }

            if (this.worldState.isBotMuted(channelCid)) {
                this.logger.warn(`[${channelCid}] 机器人已被禁言，响应终止。`);
                return;
            }

            this.scheduler.schedule(stimulus);
        });

        this.willing.startDecayCycle();
    }

    protected stop(): void {
        this.scheduler.dispose();
        this.willing.stopDecayCycle();
    }

    private _registerPromptTemplates(): void {
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
