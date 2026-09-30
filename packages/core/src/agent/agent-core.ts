import { Context, Service, Session, Random } from "koishi";

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
import { ReplyControl, ReplyCategory, ReplyTarget, messageCategories, replyKey } from "./reply-control";
import { registerReplyCommands } from "./reply-commands";
import { guardReplySession, withReplyTurn } from "./reply-turn";
import { WillingnessManager } from "./willing";

declare module "koishi" {
    interface Tables {
        "yesimbot.reply_rules": import("./reply-control").ReplyRule;
    }
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

    private activeTurns = new Map<string, AbortController>();
    private replyControl: ReplyControl;
    private modelSwitcher: ChatModelSwitcher;

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

        this.replyControl = new ReplyControl(
            {
                load: () => ctx.database.get("yesimbot.reply_rules", {}),
                save: async (rule) => {
                    await ctx.database.upsert("yesimbot.reply_rules", [rule]);
                },
                remove: async (id) => {
                    await ctx.database.remove("yesimbot.reply_rules", { id });
                },
            },
            (target) => {
                const key = replyKey(target);
                this.activeTurns.get(key)?.abort(new Error("聊天任务已取消"));
                this.willing.reset(key);
                this.scheduler?.cancel(key);
            },
            async (target, reason, rule) => {
                const names = { pause: "暂停", replace: "替换暂停规则", resume: "解除暂停", expired: "暂停到期自动解除" };
                await this.worldState.recordSystemEvent({
                    id: `reply_control_${Random.id()}`,
                    platform: target.platform,
                    channelId: target.channelId,
                    type: "reply-control",
                    timestamp: new Date(),
                    payload: { selfId: target.selfId, reason, rule },
                    message: `系统提示：机器人 ${target.selfId} ${names[reason]}。${rule ? `抑制类别：${rule.blocked.join(", ")}；截止：${rule.expiresAt === null ? "永久" : new Date(rule.expiresAt).toISOString()}。` : ""}意愿归零，消息和事件继续记录，不补发旧回复。`,
                });
            },
            Date.now,
            (error) => this.logger.warn("回复规则到期清理失败", error)
        );

        this.scheduler = new StimulusScheduler(ctx, config, async (stimulus) => {
            const target = this.replyTarget(stimulus.session);
            const token = this.replyControl.token(target);
            await this.replyControl.flush();
            if (!this.replyControl.valid(target, token) || !this.allowedCategories(stimulus).length) return;
            const channelCid = replyKey(target);
            this.willing.handlePreReply(channelCid);

            const controller = new AbortController();
            this.activeTurns.set(channelCid, controller);
            let success = false;
            try {
                success = await withReplyTurn(
                    () => !controller.signal.aborted && this.replyControl.valid(target, token),
                    async () => {
                        const session = guardReplySession(stimulus.session);
                        return this.processor.runCycle({ ...stimulus, session });
                    },
                    controller.signal,
                    (destination) => {
                        if (replyKey(destination) === channelCid) return true;
                        const rule = this.replyControl.get(destination);
                        const categories: ReplyCategory[] = destination.isDirect || rule?.isDirect ? ["text", "direct"] : ["text"];
                        return this.replyControl.allowed(destination, categories).length > 0;
                    }
                );
            } finally {
                if (this.activeTurns.get(channelCid) === controller) this.activeTurns.delete(channelCid);
            }

            if (success && this.replyControl.valid(target, token)) {
                const willingnessBeforeReply = this.willing.getCurrentWillingness(channelCid);
                this.willing.handlePostReply(stimulus.session, channelCid);
                const willingnessAfterReply = this.willing.getCurrentWillingness(channelCid);

                /* prettier-ignore */
                this.logger.debug(`[${channelCid}] 回复成功，意愿值已更新: ${willingnessBeforeReply.toFixed(2)} -> ${willingnessAfterReply.toFixed(2)}`);
            }
        });
    }

    protected async start(): Promise<void> {
        this.ctx.model.extend(
            "yesimbot.reply_rules",
            {
                id: "string",
                platform: "string",
                selfId: "string",
                channelId: "string",
                isDirect: "boolean",
                blocked: "json",
                expiresAt: { type: "double", nullable: true, initial: null },
            },
            { primary: "id" }
        );
        await this.replyControl.initialize();
        this.ctx.setInterval(() => this.replyControl.expire(), 1000);
        registerReplyCommands(this.ctx, this.replyControl, (this.config.replySuppression?.defaultDurationSeconds ?? 60) * 1000);
        this._registerPromptTemplates();

        this.ctx.on("agent/stimulus", (stimulus: AgentStimulus<any>) => {
            const { type, session } = stimulus;
            const allowed = this.allowedCategories(stimulus);
            if (!allowed.length) return;
            const channelCid = replyKey(this.replyTarget(session));

            let decision = false;

            if (type === "user_message") {
                try {
                    const willingnessBefore = this.willing.getCurrentWillingness(channelCid);
                    const result = this.willing.shouldReply(
                        session,
                        channelCid,
                        this.replyControl.get(this.replyTarget(session)) ? allowed : undefined
                    );
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

            if (this.worldState.isBotMuted(session.cid)) {
                this.logger.warn(`[${channelCid}] 机器人已被禁言，响应终止。`);
                return;
            }

            this.scheduler.schedule({ ...stimulus, channelCid });
        });

        this.willing.startDecayCycle();
    }

    protected async stop(): Promise<void> {
        this.activeTurns.forEach((controller) => controller.abort(new Error("插件已停止")));
        this.activeTurns.clear();
        this.scheduler.dispose();
        this.willing.stopDecayCycle();
        await this.replyControl.flush();
    }

    private replyTarget(session: Session): ReplyTarget {
        return { platform: session.platform, selfId: session.selfId, channelId: session.channelId, isDirect: session.isDirect };
    }

    private allowedCategories(stimulus: AgentStimulus<any>): ReplyCategory[] {
        const categories: ReplyCategory[] =
            stimulus.type === "user_message"
                ? messageCategories(stimulus.session)
                : [
                      stimulus.type === "scheduled_task"
                          ? "scheduled"
                          : stimulus.type === "background_task_completion"
                            ? "background"
                            : "system",
                  ];
        return this.replyControl.allowed(this.replyTarget(stimulus.session), categories);
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
