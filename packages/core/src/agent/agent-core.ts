import path from "node:path";

import { Context, Service, Session, Random } from "koishi";

import { Config } from "../config";
import { ChatModelSwitcher, ModelService, TaskType } from "../services/model";
import { loadTemplate, PromptService } from "../services/prompt";
import { AgentStimulus } from "../services/worldstate";
import { WorldStateService } from "../services/worldstate/index";
import { Services } from "../shared/constants";
import { AppError, handleError } from "../shared/errors";
import { ErrorDefinitions } from "../shared/errors/definitions";
import { PromptContextBuilder } from "./context-builder";
import { registerDecisionCommands } from "./decision-commands";
import { DecisionJournal } from "./decision-journal";
import { DecisionRecord, DecisionRecords, formatDecision, describeDecisionStage } from "./decision-record";
import { HeartbeatProcessor } from "./heartbeat-processor";
import { isBotMention } from "./mention";
import { registerReplyCommands } from "./reply-commands";
import { ReplyControl, ReplyCategory, ReplyTarget, messageCategories, replyKey } from "./reply-control";
import { guardReplySession, withReplyTurn } from "./reply-turn";
import { StimulusScheduler } from "./scheduler";
import { TopicManager, TopicSnapshot } from "./topics";
import { TypeSafeEvaluator } from "./typesafe";
import { WillingnessManager } from "./willing";

type TracedStimulus = AgentStimulus<any> & { decisionId?: string; topic?: TopicSnapshot };

declare module "koishi" {
    interface Tables {
        "yesimbot.reply_rules": import("./reply-control").ReplyRule;
    }
    interface Events {
        "after-send": (session: Session) => void;
    }
}

export class AgentCore extends Service<Config> {
    static readonly inject = [Services.Asset, Services.Logger, Services.Memory, Services.Model, Services.Prompt, Services.Tool, Services.WorldState];

    // 依赖的服务
    private readonly worldState: WorldStateService;
    private readonly modelService: ModelService;
    private readonly promptService: PromptService;

    // 核心组件
    private willing: WillingnessManager;
    private scheduler: StimulusScheduler;
    private contextBuilder: PromptContextBuilder;
    private processor: HeartbeatProcessor;
    private topics?: TopicManager;
    private topicScores = new Map<string, Set<string>>();

    private activeTurns = new Map<string, AbortController>();
    private replyControl: ReplyControl;
    private modelSwitcher: ChatModelSwitcher;
    private readonly pendingAssessments = new Map<string, { controller: AbortController; stimulus: AgentStimulus<any>; token: number }>();
    private stopped = false;
    private decisionJournal?: DecisionJournal;
    private readonly decisions = new DecisionRecords(1000, Date.now, (record) => {
        void this.decisionJournal?.append(record);
    });
    private readonly activeDecisionIds = new Map<string, string>();

    private recordDecision(stimulus: AgentStimulus<any>, update: Partial<DecisionRecord>): void {
        this.decisions?.update((stimulus as TracedStimulus).decisionId, update);
    }

    public queryDecision(session: Session): string {
        const target = this.replyTarget(session);
        const key = replyKey(target);
        const diagnostic = formatDecision(this.decisions.latest(target), {
            score: this.willing.getCurrentWillingness(
                this.topics?.getTopics(key).find((topic) => topic.id === this.topics?.getFocus(key)?.id)?.scoreKey ?? key,
            ),
            busy: this.scheduler.isBusy(key),
            assessing: this.pendingAssessments.has(key),
            muted: this.worldState.peekBotMuted(session.cid, session.selfId),
            participation: this.willing.getParticipation(key),
            suppression: this.replyControl.peek(target),
        });
        const topics = this.topics?.getTopics(key) ?? [];
        return topics.length
            ? diagnostic +
                  "\n话题意愿：" +
                  topics
                      .map(
                          (topic) =>
                              `${JSON.stringify(topic.label)} ${this.willing.getCurrentWillingness(topic.scoreKey).toFixed(2)}（占比 ${(topic.share * 100).toFixed(0)}%）`,
                      )
                      .join("；")
            : diagnostic;
    }

    public async queryDecisionRecords(session: Session, filter: { limit: number; from?: number; to?: number }): Promise<string> {
        if (!this.decisionJournal) return "尚未启用本地决策记录，请先开启配置中的“决策记录与回放”。";
        const records = await this.decisionJournal.list({ ...filter, key: replyKey(this.replyTarget(session)) });
        const lines = records.map(
            (record) =>
                `${new Date(record.time).toISOString()} ${record.id}\n${describeDecisionStage(record.stage)}${record.probability === undefined ? "" : `；概率 ${(record.probability * 100).toFixed(1)}%`}${record.roll === undefined ? "" : `；随机数 ${record.roll}`}`,
        );
        const diagnostics = this.decisionJournal.diagnostics;
        if (diagnostics.droppedRecords) lines.push(`本次运行已裁剪或丢弃 ${diagnostics.droppedRecords} 条快照，历史可能不完整。`);
        return lines.length ? lines.join("\n") : "所选时间范围没有该会话的记录。";
    }

    private cancelAssessment(channelCid: string, settle = true, reason = "reply_suppressed"): void {
        const pending = this.pendingAssessments.get(channelCid);
        if (!pending) return;
        this.pendingAssessments.delete(channelCid);
        pending.controller.abort();
        this.recordDecision(pending.stimulus, { assessment: { mode: this.config.typesafe?.mode ?? "off", multiplier: null, status: "cancelled" } });
        if (settle && this.replyControl.valid(this.replyTarget(pending.stimulus.session), pending.token)) {
            this.processStimulus(pending.stimulus, 1, false);
        } else this.recordDecision(pending.stimulus, { stage: "cancelled", reason });
    }

    private receiveStimulus(stimulus: TracedStimulus): void {
        if (this.stopped) return;
        const { session, type } = stimulus;
        const channelCid = replyKey(this.replyTarget(session));
        stimulus = { ...stimulus, channelCid, decisionId: this.decisions?.begin(this.replyTarget(session), type) };
        if (!this.allowedCategories(stimulus).length) {
            this.recordDecision(stimulus, { stage: "blocked", reason: "reply_suppressed", allowed: [] });
            return;
        }
        if (this.worldState.isBotMuted(session.cid, session.selfId)) {
            this.recordDecision(stimulus, { stage: "blocked", reason: "muted" });
            return;
        }
        if (type === "user_message") {
            this.topics?.noteMessage(session, channelCid);
            this.scheduler.noteUserMessage(channelCid);
        }
        this.cancelAssessment(channelCid);
        const config = this.config.typesafe;
        const addressed = session?.isDirect || isBotMention(session);
        const useTypeSafe = config && config.mode !== "off" && config.evaluationModel?.providerName && config.evaluationModel.modelId;
        const useTopics = this.config.topics?.enabled && this.config.topics.model?.providerName && this.config.topics.model.modelId;
        if (type !== "user_message" || addressed || this.scheduler.isBusy(channelCid) || (!useTypeSafe && !useTopics)) {
            this.recordDecision(stimulus, { assessment: { mode: config?.mode ?? "off", multiplier: null, status: "bypassed" } });
            const cachedTopic = type === "user_message" && !addressed && useTopics ? this.topics?.getCurrent(channelCid) : undefined;
            this.processStimulus(cachedTopic ? { ...stimulus, topic: cachedTopic } : stimulus);
            return;
        }
        const target = this.replyTarget(session);
        const pending = { controller: new AbortController(), stimulus, token: this.replyControl.token(target) };
        this.pendingAssessments.set(channelCid, pending);
        let answers: { addressed: number; interested: number; others: number } | undefined;
        this.recordDecision(stimulus, { stage: "assessing", assessment: { mode: config?.mode ?? "off", multiplier: null, status: "pending" } });
        const semantic = useTypeSafe
            ? new TypeSafeEvaluator(this.ctx, this.config).evaluate(session, pending.controller.signal, (value) => {
                  answers = value;
              })
            : Promise.resolve(null);
        const topic = useTopics ? this.topics!.assess(session, channelCid, pending.controller.signal, false) : Promise.resolve(undefined);
        void Promise.all([semantic, topic]).then(
            ([multiplier, snapshot]) => {
                if (this.stopped || this.pendingAssessments.get(channelCid) !== pending || !this.replyControl.valid(target, pending.token)) return;
                this.pendingAssessments.delete(channelCid);
                this.recordDecision(stimulus, {
                    assessment: { mode: config?.mode ?? "off", multiplier, answers, status: multiplier === null ? "unavailable" : "completed" },
                });
                this.processStimulus({ ...stimulus, topic: snapshot }, config?.mode === "adjust" ? (multiplier ?? 1) : 1);
            },
            () => {
                if (this.pendingAssessments.get(channelCid) !== pending || this.stopped || !this.replyControl.valid(target, pending.token)) return;
                this.pendingAssessments.delete(channelCid);
                this.processStimulus(stimulus);
            },
        );
    }

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Agent, true);
        this.config = config;
        this.logger = ctx[Services.Logger].getLogger("[智能体核心]");
        if (config.decisionRecording?.enabled) {
            this.decisionJournal = new DecisionJournal(
                path.resolve(ctx.baseDir, config.decisionRecording.directory || "data/yesimbot/decisions"),
                config.decisionRecording,
                (message) => this.logger.warn(message),
            );
        }

        this.worldState = this.ctx[Services.WorldState];
        this.modelService = this.ctx[Services.Model];
        this.promptService = this.ctx[Services.Prompt];

        this.modelSwitcher = this.modelService.useChatGroup(TaskType.Chat)!;
        if (!this.modelSwitcher) {
            const notifier = ctx.notifier.create({
                type: "danger",
                content: `未给 '聊天 (Chat)' 任务类型配置任何模型组，请前往“模型服务”设置，并为 '聊天' 任务类型至少配置一个模型`,
            });
        }

        this.willing = new WillingnessManager(ctx, config);
        if (config.topics?.enabled)
            this.topics = new TopicManager(
                ctx,
                config.topics,
                (session) => config.typesafe?.interests?.trim() || session.resolve(config.interest.keywords).join("、"),
                (key) => this.clearTopicScores(key),
            );

        this.contextBuilder = new PromptContextBuilder(ctx, config, this.modelSwitcher);
        this.processor = new HeartbeatProcessor(
            ctx,
            config,
            this.modelSwitcher,
            ctx[Services.Prompt],
            ctx[Services.Tool],
            this.worldState.l1_manager,
            this.contextBuilder,
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
            (target, reason) => {
                const key = replyKey(target);
                this.cancelAssessment(key, false);
                this.activeTurns.get(key)?.abort(new Error("聊天任务已取消"));
                this.decisions.update(this.activeDecisionIds.get(key), { stage: "cancelled", reason, success: false });
                this.resetWillingness(key);
                this.scheduler?.cancel(key);
            },
            async (target, reason, rule, actor) => {
                const names: Record<string, string> = { pause: "暂停", replace: "替换暂停规则", resume: "解除暂停", expired: "暂停到期自动解除" };
                await this.worldState.recordSystemEvent({
                    id: `reply_control_${Random.id()}`,
                    platform: target.platform,
                    channelId: target.channelId,
                    type: "reply-control",
                    timestamp: new Date(),
                    payload: {
                        selfId: target.selfId,
                        reason,
                        rule,
                        actor: actor?.id || (reason === "expired" ? "framework-timer" : "unknown"),
                        origin: actor?.origin,
                        operation: `reply.${reason}`,
                        scope: "channel",
                        target,
                        status: "success",
                        time: new Date().toISOString(),
                    },
                    message: `系统提示：机器人 ${target.selfId} ${names[reason]}。${rule ? `抑制类别：${rule.blocked.join(", ")}；截止：${rule.expiresAt == null ? "永久" : new Date(rule.expiresAt).toISOString()}。` : ""}意愿归零，消息和事件继续记录，不补发旧回复。`,
                });
            },
            Date.now,
            (error) => this.logger.warn("回复规则到期清理失败", error),
        );

        this.scheduler = new StimulusScheduler(
            ctx,
            config,
            async (stimulus) => {
                const target = this.replyTarget(stimulus.session);
                const token = this.replyControl.token(target);
                const channelCid = replyKey(target);
                // 在首个异步等待前登记，禁言后立即解禁也不能恢复旧任务。
                const controller = new AbortController();
                this.activeTurns.set(channelCid, controller);
                this.activeDecisionIds.set(channelCid, (stimulus as TracedStimulus).decisionId!);
                let success = false;
                const valid = () =>
                    !controller.signal.aborted && this.replyControl.valid(target, token) && !this.worldState.isBotMuted(stimulus.session.cid, target.selfId);
                try {
                    await this.replyControl.flush();
                    if (controller.signal.aborted || !this.replyControl.valid(target, token) || !this.allowedCategories(stimulus).length) {
                        this.recordDecision(stimulus, { stage: "cancelled", reason: "invalid_generation", success: false });
                        return;
                    }
                    if (this.worldState.isBotMuted(stimulus.session.cid, target.selfId)) {
                        this.recordDecision(stimulus, { stage: "blocked", reason: "muted", success: false });
                        return;
                    }
                    this.cancelAssessment(channelCid);
                    this.willing.handlePreReply(channelCid);
                    success = await withReplyTurn(
                        valid,
                        async () => {
                            const session = guardReplySession(stimulus.session);
                            return this.processor.runCycle({ ...stimulus, session });
                        },
                        controller.signal,
                        (destination) => {
                            if (this.worldState.isBotMuted(`${destination.platform}:${destination.channelId}`, destination.selfId)) return false;
                            if (replyKey(destination) === channelCid) return true;
                            const rule = this.replyControl.get(destination);
                            const categories: ReplyCategory[] = destination.isDirect || rule?.isDirect ? ["text", "direct"] : ["text"];
                            return this.replyControl.allowed(destination, categories).length > 0;
                        },
                    );
                } catch (error) {
                    this.recordDecision(stimulus, {
                        stage: controller.signal.aborted ? "cancelled" : "failed",
                        reason: controller.signal.aborted ? "reply_suppressed" : "exception",
                        success: false,
                    });
                    throw error;
                } finally {
                    if (this.activeTurns.get(channelCid) === controller) this.activeTurns.delete(channelCid);
                    this.activeDecisionIds.delete(channelCid);
                }

                const replyTopic = (stimulus as TracedStimulus).topic;
                if (success && valid() && (!replyTopic || this.topicScores.get(channelCid)?.has(replyTopic.scoreKey))) {
                    const scoreKey = replyTopic?.scoreKey ?? channelCid;
                    const willingnessBeforeReply = this.willing.getCurrentWillingness(scoreKey);
                    this.willing.handlePostReply(stimulus.session, scoreKey, 0, channelCid);
                    const willingnessAfterReply = this.willing.getCurrentWillingness(scoreKey);

                    /* prettier-ignore */
                    this.logger.debug(`[${channelCid}] 回复成功，意愿值已更新: ${willingnessBeforeReply.toFixed(2)} -> ${willingnessAfterReply.toFixed(2)}`);
                }
                const completed = valid();
                this.recordDecision(stimulus, {
                    stage: completed ? "completed" : "cancelled",
                    reason: !completed ? "invalid_generation" : success ? undefined : "no_reply",
                    success: success && completed,
                    score: this.willing.getCurrentWillingness((stimulus as TracedStimulus).topic?.scoreKey ?? channelCid),
                    participation: this.willing.getParticipation(channelCid),
                });
            },
            (stimulus, stage, reason) => this.recordDecision(stimulus, { stage, reason }),
        );

        this.ctx.on("agent/bot-muted", (target) => {
            const key = replyKey(target);
            this.cancelAssessment(key, false, "muted");
            this.activeTurns.get(key)?.abort(new Error("机器人已被禁言"));
            this.decisions.update(this.activeDecisionIds.get(key), { stage: "cancelled", reason: "muted", success: false });
            this.resetWillingness(key);
            this.scheduler.cancel(key, "muted");
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
            { primary: "id" },
        );
        await this.replyControl.initialize();
        this.ctx.setInterval(() => this.replyControl.expire(), 1000);
        registerReplyCommands(this.ctx, this.replyControl, (this.config.replySuppression?.defaultDurationSeconds ?? 60) * 1000);
        registerDecisionCommands(
            this.ctx,
            (session) => this.queryDecision(session),
            (session, filter) => this.queryDecisionRecords(session, filter),
        );
        this._registerPromptTemplates();

        this.ctx.on("agent/stimulus", (stimulus) => this.receiveStimulus(stimulus));

        this.willing.startDecayCycle();
    }

    private processStimulus(stimulus: TracedStimulus, assessmentMultiplier = 1, allowSchedule = true): void {
        const { type, session } = stimulus;
        const allowed = this.allowedCategories(stimulus);
        if (!allowed.length) {
            this.recordDecision(stimulus, { stage: "blocked", reason: "reply_suppressed", allowed: [] });
            return;
        }
        const channelCid = replyKey(this.replyTarget(session));

        if (this.worldState.isBotMuted(session.cid, session.selfId)) {
            this.recordDecision(stimulus, { stage: "blocked", reason: "muted" });
            this.logger.warn(`[${channelCid}] 机器人已被禁言，响应终止。`);
            return;
        }

        let decision = false;

        if (type === "user_message") {
            try {
                const topic = (stimulus as TracedStimulus).topic;
                const candidates = topic ? (this.topics?.getTopics(channelCid) ?? []) : [];
                if (topic) this.trackTopicScores(channelCid, candidates);
                const willingnessBefore = this.willing.getCurrentWillingness(channelCid);
                const replyRule = this.replyControl.get(this.replyTarget(session));
                const categories = replyRule ? allowed : undefined;
                const result = topic
                    ? this.willing.shouldReply(session, channelCid, categories, assessmentMultiplier, {
                          currentScoreKey: topic.scoreKey,
                          multiplier: topic.multiplier,
                          candidates,
                          latestTopicPreference: this.config.topics?.latestTopicPreference,
                      })
                    : this.willing.shouldReply(session, channelCid, categories, assessmentMultiplier);
                const scoreKey = result.scoreKey ?? channelCid;
                const willingnessAfter = this.willing.getCurrentWillingness(scoreKey);
                if (topic) {
                    const focus = candidates.find((candidate) => candidate.scoreKey === scoreKey);
                    if (focus) {
                        this.topics?.chooseFocus(channelCid, focus.id);
                        stimulus = { ...stimulus, topic: focus } as TracedStimulus;
                    }
                }
                const forcedMention = this.config.prioritizeMentions && !replyRule && isBotMention(session) && allowed.includes("at");
                decision = !!forcedMention || result.decision;
                this.recordDecision(stimulus, {
                    stage: "calculated",
                    allowed,
                    decision,
                    forcedReply: !!forcedMention,
                    probability: result.probability,
                    roll: result.roll,
                    calculation: result.calculation,
                    score: willingnessAfter,
                    participation: this.willing.getParticipation?.(channelCid),
                    reason: forcedMention ? "forced_reply_by_mention" : result.probability === 0 ? "below_threshold" : "probability_roll",
                });

                /* prettier-ignore */
                this.logger.debug(`[${channelCid}] 意愿计算: ${willingnessBefore.toFixed(2)} -> ${willingnessAfter.toFixed(2)} | 回复概率: ${(result.probability * 100).toFixed(1)}% | 初步决策: ${decision}`);
            } catch (error) {
                this.recordDecision(stimulus, { stage: "failed", reason: "exception" });
                handleError(
                    this.logger,
                    new AppError(ErrorDefinitions.WILLINGNESS.CALCULATION_FAILED, {
                        cause: error as Error,
                        context: { channelCid },
                    }),
                    `Willingness calculation (Channel: ${channelCid})`,
                );
                return;
            }
        } else {
            decision = true;
            this.recordDecision(stimulus, { stage: "calculated", decision, allowed });
            this.logger.info(`[${channelCid}] 接收到系统刺激 [${type}]，自动触发响应。`);
        }

        if (!decision || !allowSchedule) {
            this.recordDecision(stimulus, !allowSchedule ? { stage: "skipped", reason: "not_scheduled" } : { stage: "skipped" });
            return;
        }

        this.recordDecision(stimulus, { stage: "scheduled" });
        this.scheduler.schedule({ ...stimulus, channelCid });
    }

    protected async stop(): Promise<void> {
        this.stopped = true;
        for (const channelCid of this.pendingAssessments.keys()) this.cancelAssessment(channelCid, false);
        this.activeTurns.forEach((controller) => controller.abort(new Error("插件已停止")));
        this.activeTurns.clear();
        for (const id of this.activeDecisionIds.values()) this.decisions.update(id, { stage: "cancelled", reason: "stopped", success: false });
        this.activeDecisionIds.clear();
        this.topics?.dispose();
        this.scheduler.dispose();
        this.willing.stopDecayCycle();
        await this.replyControl.flush();
        await this.decisionJournal?.close();
    }

    private clearTopicScores(channelKey: string): void {
        for (const key of this.topicScores.get(channelKey) ?? []) this.willing.reset(key);
        this.topicScores.delete(channelKey);
    }

    private resetWillingness(channelKey: string): void {
        this.topics?.reset(channelKey);
        this.clearTopicScores(channelKey);
        this.willing.reset(channelKey);
    }

    private trackTopicScores(channelKey: string, snapshots: TopicSnapshot[]): void {
        const keys = new Set(snapshots.map((topic) => topic.scoreKey));
        for (const old of this.topicScores.get(channelKey) ?? []) if (!keys.has(old)) this.willing.reset(old);
        this.topicScores.set(channelKey, keys);
    }

    private replyTarget(session: Session): ReplyTarget {
        return { platform: session.platform, selfId: session.selfId, channelId: session.channelId!, isDirect: session.isDirect };
    }

    private allowedCategories(stimulus: AgentStimulus<any>): ReplyCategory[] {
        const categories: ReplyCategory[] =
            stimulus.type === "user_message"
                ? messageCategories(stimulus.session)
                : [stimulus.type === "scheduled_task" ? "scheduled" : stimulus.type === "background_task_completion" ? "background" : "system"];
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
