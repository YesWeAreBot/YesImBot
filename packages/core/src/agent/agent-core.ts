import { Context, Service, Session } from "koishi";

import { Config } from "@/config";
import { ChatModelSwitcher, ModelService, TaskType } from "@/services/model";
import { loadTemplate, PromptService } from "@/services/prompt";
import { AgentStimulus } from "@/services/worldstate";
import { WorldStateService } from "@/services/worldstate/index";
import { Services } from "@/shared/constants";
import { AppError, handleError } from "@/shared/errors";
import { ErrorDefinitions } from "@/shared/errors/definitions";
import { PromptContextBuilder } from "./context-builder";
import { HeartbeatProcessor } from "./heartbeat-processor";
import { StimulusScheduler } from "./scheduler";
import { TypeSafeEvaluator } from "./typesafe";
import { WillingnessManager } from "./willing";

declare module "koishi" {
    interface Events {
        "after-send": (session: Session) => void;
    }
}

export class AgentCore extends Service<Config> {
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
    private readonly pendingAssessments = new Map<string, { controller: AbortController; stimulus: AgentStimulus<any> }>();
    private stopped = false;

    private cancelAssessment(channelCid: string, settle = true): void {
        const pending = this.pendingAssessments.get(channelCid);
        if (!pending) return;
        this.pendingAssessments.delete(channelCid);
        pending.controller.abort();
        if (settle) this.processStimulus(pending.stimulus, 1, false);
    }

    private receiveStimulus(stimulus: AgentStimulus<any>): void {
        if (this.stopped) return;
        const { channelCid, session, type } = stimulus;
        if (type === "user_message") this.scheduler.noteUserMessage(channelCid);
        this.cancelAssessment(channelCid);
        const config = this.config.typesafe;
        const addressed = session?.isDirect || session?.stripped?.atSelf
            || session?.elements?.some(e => e.type === "at" && e.attrs.id === session.bot.selfId);
        if (type !== "user_message" || !config || config.mode === "off" || addressed
            || this.scheduler.isBusy(channelCid)
            || !config.evaluationModel?.providerName || !config.evaluationModel.modelId) {
            this.processStimulus(stimulus);
            return;
        }
        const pending = { controller: new AbortController(), stimulus };
        this.pendingAssessments.set(channelCid, pending);
        const finish = (multiplier: number | null) => {
            if (this.stopped || this.pendingAssessments.get(channelCid) !== pending) return;
            this.pendingAssessments.delete(channelCid);
            this.logger.debug(`[${channelCid}] TypeSafe 增益乘数: ${multiplier ?? "不可用，沿用原计算"}`);
            this.processStimulus(stimulus, config.mode === "adjust" ? multiplier ?? 1 : 1);
        };
        void new TypeSafeEvaluator(this.ctx, this.config).evaluate(session, pending.controller.signal).then(finish, () => finish(null));
    }

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Agent, true);
        this.config = config;
        this.logger = ctx[Services.Logger].getLogger("[智能体核心]");

        this.worldState = this.ctx[Services.WorldState];
        this.modelService = this.ctx[Services.Model];
        this.promptService = this.ctx[Services.Prompt];

        this.modelSwitcher = this.modelService.useChatGroup(TaskType.Chat);
        if (!this.modelSwitcher) {
            const notifier = ctx.notifier.create({
                type: "danger",
                content: `未给 '聊天 (Chat)' 任务类型配置任何模型组，请前往“模型服务”设置，并为 '聊天' 任务类型至少配置一个模型`,
            });
        }

        this.willing = new WillingnessManager(ctx, config);

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

            this.cancelAssessment(channelCid);
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

        this.ctx.on("agent/stimulus", stimulus => this.receiveStimulus(stimulus));

        this.willing.startDecayCycle();
    }

    private processStimulus(stimulus: AgentStimulus<any>, assessmentMultiplier = 1, allowSchedule = true): void {
            const { type, channelCid, session } = stimulus;

            let decision = false;

            if (type === "user_message") {
                try {
                    const willingnessBefore = this.willing.getCurrentWillingness(channelCid);
                    const result = this.willing.shouldReply(session, assessmentMultiplier);
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

            if (!decision || !allowSchedule) {
                return;
            }

            if (this.worldState.isBotMuted(channelCid)) {
                this.logger.warn(`[${channelCid}] 机器人已被禁言，响应终止。`);
                return;
            }

            this.scheduler.schedule(stimulus);
    }

    protected stop(): void {
        this.stopped = true;
        for (const channelCid of this.pendingAssessments.keys()) this.cancelAssessment(channelCid, false);
        this.scheduler.dispose();
        this.willing.stopDecayCycle();
    }

    private _registerPromptTemplates(): void {
        // 注册所有可重用的局部模板
        this.promptService.registerTemplate("agent.partial.world_state", loadTemplate("world_state"));
        this.promptService.registerTemplate("agent.partial.l1_history_item", loadTemplate("l1_history_item"));

        // 注册主模板
        this.promptService.registerTemplate("agent.system", this.config.systemTemplate);
        this.promptService.registerTemplate("agent.user", this.config.userTemplate);

        // 注册动态片段
        this.promptService.registerSnippet("agent.context.currentTime", () => new Date().toISOString());
    }
}
