import type { Context, Session } from "koishi";
import type { Config } from "@/config";

import type { HorizonService, Percept, UserMessagePercept } from "@/services/horizon";
import type { ModelService } from "@/services/model";
import type { PromptService } from "@/services/prompt";
import { Service } from "koishi";
import { ChatModelSwitcher } from "@/services/model";
import { Services } from "@/shared/constants";
import { HeartbeatProcessor } from "./heartbeat-processor";
import { TypeSafeEvaluator } from "./typesafe";
import { WillingnessManager } from "./willing";

type WithDispose<T> = T & { dispose: () => void };

declare module "koishi" {
    interface Events {
        "after-send": (session: Session) => void;
    }
}

export class AgentCore extends Service<Config> {
    static readonly inject = {
        [Services.Asset]: { required: true },
        [Services.Memory]: { required: true },
        [Services.Model]: { required: true },
        [Services.Prompt]: { required: true },
        [Services.Plugin]: { required: true },
        [Services.Horizon]: { required: true },
        http: { required: false },
    };

    // 依赖的服务
    private readonly horizon: HorizonService;
    private readonly model: ModelService;
    private readonly prompt: PromptService;

    // 核心组件
    private willing: WillingnessManager;
    private processor: HeartbeatProcessor;
    private readonly typesafe: TypeSafeEvaluator;
    private readonly pendingAssessments = new Map<string, {
        percept: UserMessagePercept;
        controller: AbortController;
        active: boolean;
    }>();

    private modelSwitcher: ChatModelSwitcher;

    private stopped = false;
    private readonly runningTasks = new Set<string>();
    private readonly scheduledMessages = new Map<string, UserMessagePercept>();
    private readonly pendingMessages = new Map<string, UserMessagePercept>();
    private readonly debouncedReplyTasks = new Map<string, WithDispose<(percept: Percept) => void>>();
    private readonly deferredTimers = new Map<string, NodeJS.Timeout>();
    private readonly queuedMessages = new Map<string, UserMessagePercept[]>();

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Agent, true);
        this.config = config;

        this.horizon = this.ctx[Services.Horizon];
        this.model = this.ctx[Services.Model];
        this.prompt = this.ctx[Services.Prompt];

        const groupName = this.config.chatModelGroup || this.config.groups?.[0]?.name;
        const group = this.config.groups?.find((g) => g.name === groupName);
        if (!group)
            throw new Error(`无法找到聊天模型组: ${groupName}`);

        const models = this.model.resolveChatModels(group.name);

        this.modelSwitcher = new ChatModelSwitcher(this.logger, this.model, { name: group.name, models }, this.config.switchConfig);
        this.willing = new WillingnessManager(ctx, config);
        this.typesafe = new TypeSafeEvaluator(ctx, config, this.horizon);
        this.processor = new HeartbeatProcessor(ctx, config, this.modelSwitcher);
    }

    protected async start(): Promise<void> {
        this.ctx.on("horizon/percept", (percept) => {
            this.dispatch(percept);
        });

        this.willing.startDecayCycle();
    }

    protected stop(): void {
        this.stopped = true;
        this.pendingAssessments.forEach(pending => pending.controller.abort());
        this.pendingAssessments.clear();
        this.debouncedReplyTasks.forEach((task) => task.dispose());
        this.deferredTimers.forEach((timer) => clearTimeout(timer));
        this.queuedMessages.clear();
        this.debouncedReplyTasks.clear();
        this.deferredTimers.clear();
        this.scheduledMessages.clear();
        this.pendingMessages.clear();
        this.willing.stopDecayCycle();
    }

    /**
     * 感知分发器
     * 根据感知类型分发到不同的处理逻辑
     */
    private dispatch(percept: Percept): void {
        switch (percept.type) {
            case "user.message": // PerceptType.UserMessage
                this.handleUserMessage(percept);
                break;
            // case PerceptType.SystemSignal:
            //     this.handleSystemSignal(percept);
            //     break;
            default:
                this.logger.warn(`未知的感知类型: ${(percept as any).type}`);
        }
    }

    private handleUserMessage(percept: UserMessagePercept): void {
        if (this.stopped)
            return;
        const { channel } = percept.payload;
        const channelKey = `${channel.platform}:${channel.id}`;
        // 所有新消息都重置安静期，不受意愿判断和语义请求耗时影响。
        if (this.deferredTimers.has(channelKey))
            this.setupDeferredTimer(channelKey);
        this.settlePendingAssessment(channelKey);

        const mode = this.config.typesafe?.mode ?? "off";
        if (mode === "off" || !this.config.typesafe?.apiKey?.trim() || !this.ctx.http
            || !percept.runtime?.session || this.isForcedPercept(percept) || this.runningTasks.has(channelKey)) {
            this.applyWillingness(percept);
            return;
        }
        if (mode === "observe")
            this.applyWillingness(percept);

        const pending = { percept, controller: new AbortController(), active: mode === "active" };
        this.pendingAssessments.set(channelKey, pending);
        void this.typesafe.evaluate(percept, pending.controller.signal).catch(() => null).then((assessment) => {
            if (this.pendingAssessments.get(channelKey) !== pending)
                return;
            this.pendingAssessments.delete(channelKey);
            if (assessment) {
                const { addressed, interested, others, multiplier, model } = assessment;
                this.logger.debug(`[${channelKey}] TypeSafe (${mode}, ${model}): 对我说=${addressed.toFixed(2)}, 兴趣=${interested.toFixed(2)}, 对他人说=${others.toFixed(2)}, 增益乘数=${multiplier.toFixed(2)}`);
            } else {
                this.logger.debug(`[${channelKey}] TypeSafe 无有效判断，沿用原意愿计算`);
            }
            if (pending.active)
                this.applyWillingness(percept, assessment?.multiplier ?? 1);
        });
    }

    private settlePendingAssessment(channelKey: string): void {
        const pending = this.pendingAssessments.get(channelKey);
        if (!pending)
            return;
        this.pendingAssessments.delete(channelKey);
        pending.controller.abort();
        // 按到达顺序累计被替代消息的原始增益，禁止过期判断触发回复。
        if (pending.active)
            this.applyWillingness(pending.percept, 1, false);
    }

    private applyWillingness(percept: UserMessagePercept, gainMultiplier: number = 1, allowReply: boolean = true): void {
        const { channel, sender } = percept.payload;
        const channelKey = `${channel.platform}:${channel.id}`;

        // 1. 意愿检测 (Willingness)
        let decision = false;
        try {
            // 注意：这里我们需要传递 session 给 willing 模块，因为它可能依赖 session 的某些属性
            // 如果 willing 模块未来解耦，这里也可以只传 payload
            if (!percept.runtime?.session) {
                this.logger.warn(`[${channelKey}] 缺少运行时 Session，跳过意愿检测`);
                return;
            }

            const willingnessBefore = this.willing.getCurrentWillingness(channelKey);
            const result = this.willing.shouldReply(percept.runtime.session, gainMultiplier);
            const willingnessAfter = this.willing.getCurrentWillingness(channelKey);

            decision = result.decision;
            /* prettier-ignore */
            this.logger.debug(`[${channelKey}] 意愿计算: ${willingnessBefore.toFixed(2)} -> ${willingnessAfter.toFixed(2)} | 回复概率: ${(result.probability * 100).toFixed(1)}% | 初步决策: ${decision}`);
        } catch (error: any) {
            this.logger.error(`计算意愿值失败，已阻止本次响应: ${error.message}`);
            return;
        }

        if (!decision || !allowReply) {
            return;
        }

        // 2. 调度任务
        this.schedule(percept);
    }

    public schedule(percept: Percept): void {
        if (this.stopped || percept.type !== "user.message")
            return;

        const { channel } = percept.payload;
        const channelKey = `${channel.platform}:${channel.id}`;
        const forced = this.isForcedPercept(percept);
        const scheduled = this.scheduledMessages.get(channelKey);

        // 强制回复在防抖期间也保留队列位置，避免被后来的普通消息覆盖。
        if (this.runningTasks.has(channelKey) || (scheduled && this.isForcedPercept(scheduled))) {
            if (forced) {
                const queue = this.queuedMessages.get(channelKey) ?? [];
                queue.push(percept);
                this.queuedMessages.set(channelKey, queue);
                this.logger.info(`[${channelKey}] 频道忙，@/私聊消息已排队，等待当前任务结束`);
            }
            else if (this.config.newMessageStrategy === "immediate" || this.config.newMessageStrategy === "deferred") {
                this.pendingMessages.set(channelKey, percept);
            }
            else {
                this.logger.info(`[${channelKey}] 频道当前有任务在运行，跳过本次响应`);
            }
            return;
        }

        if (!forced && this.deferredTimers.has(channelKey)) {
            // 安静期由接收消息时重置，语义判断完成不能再次延长等待。
            this.pendingMessages.set(channelKey, percept);
            return;
        }

        this.clearDeferredTimer(channelKey);
        this.scheduledMessages.set(channelKey, percept);
        this.getDebouncedTask(channelKey)(percept);
    }

    private getDebouncedTask(channelKey: string): WithDispose<(percept: UserMessagePercept) => void> {
        let debouncedTask = this.debouncedReplyTasks.get(channelKey);
        if (!debouncedTask) {
            debouncedTask = this.ctx.debounce((percept: UserMessagePercept) => {
                this.scheduledMessages.delete(channelKey);
                return this.executeTask(channelKey, percept);
            }, this.config.debounceMs);
            this.debouncedReplyTasks.set(channelKey, debouncedTask);
        }
        return debouncedTask;
    }

    private async executeTask(channelKey: string, percept: UserMessagePercept): Promise<void> {
        if (this.stopped)
            return;
        if (this.runningTasks.has(channelKey)) {
            this.schedule(percept);
            return;
        }

        // 本轮上下文包含此前的新消息，结算语义判断并清除已被本轮覆盖的普通积压消息。
        this.settlePendingAssessment(channelKey);
        this.pendingMessages.delete(channelKey);
        this.clearDeferredTimer(channelKey);
        this.runningTasks.add(channelKey);
        this.logger.debug(`[${channelKey}] 锁定频道并开始执行任务`);
        try {
            this.willing.handlePreReply(channelKey);
            const success = await this.processor.runCycle(percept);
            if (success && percept.runtime?.session) {
                const willingnessBeforeReply = this.willing.getCurrentWillingness(channelKey);
                this.willing.handlePostReply(percept.runtime.session, channelKey);
                const willingnessAfterReply = this.willing.getCurrentWillingness(channelKey);
                /* prettier-ignore */
                this.logger.debug(`[${channelKey}] 回复成功，意愿值已更新: ${willingnessBeforeReply.toFixed(2)} -> ${willingnessAfterReply.toFixed(2)}`);
            }
        } catch (error: any) {
            this.logger.error(`调度任务执行失败 (Channel: ${channelKey}): ${error.message}`);
        } finally {
            this.runningTasks.delete(channelKey);
            this.logger.debug(`[${channelKey}] 频道锁已释放`);
            if (!this.stopped)
                this.schedulePendingMessage(channelKey);
        }
    }

    private schedulePendingMessage(channelKey: string): void {
        const queue = this.queuedMessages.get(channelKey);
        const next = queue?.shift();
        if (!queue?.length)
            this.queuedMessages.delete(channelKey);
        if (next) {
            this.schedule(next);
            return;
        }

        const pending = this.pendingMessages.get(channelKey);
        if (!pending)
            return;
        if (this.config.newMessageStrategy === "immediate") {
            this.pendingMessages.delete(channelKey);
            this.schedule(pending);
        }
        else if (this.config.newMessageStrategy === "deferred") {
            this.setupDeferredTimer(channelKey);
        }
        else {
            this.pendingMessages.delete(channelKey);
        }
    }

    private clearDeferredTimer(channelKey: string): void {
        const timer = this.deferredTimers.get(channelKey);
        if (timer !== undefined)
            clearTimeout(timer);
        this.deferredTimers.delete(channelKey);
    }

    private setupDeferredTimer(channelKey: string): void {
        this.clearDeferredTimer(channelKey);
        const timer = setTimeout(() => {
            this.deferredTimers.delete(channelKey);
            if (this.stopped || this.runningTasks.has(channelKey))
                return;
            const pending = this.pendingMessages.get(channelKey);
            // 安静期已完成消息合并，直接进入互斥执行，避免再次防抖造成调度空档。
            if (pending)
                void this.executeTask(channelKey, pending);
        }, this.config.deferredProcessingTime ?? 10000);
        this.deferredTimers.set(channelKey, timer);
    }

    private isForcedPercept(percept: UserMessagePercept): boolean {
        const session = percept.runtime?.session;
        return session ? this.willing.isForcedReply(session) : false;
    }
}
