import { Context, Logger } from "koishi";

import type { LoggerService } from "../logger";
import { AppError, ErrorDefinitions, handleError } from "../shared/errors";
import { AgentStimulus } from "../world";
import { AgentBehaviorConfig } from "./config";
import { isBotMention } from "./mention";

type TaskCallback = (stimulus: AgentStimulus<any>) => Promise<any>;
type WithDispose<T> = T & { dispose: () => void };

/**
 * @description 负责调度 Agent 刺激的处理。
 * 它管理并发、防抖以及在频道繁忙时根据策略处理新消息。
 */
export class StimulusScheduler {
    private readonly logger: Logger;
    private readonly runningTasks = new Set<string>();
    private readonly debouncedReplyTasks = new Map<string, WithDispose<(stimulus: AgentStimulus<any>) => void>>();
    private readonly skippedStimulus = new Map<string, AgentStimulus<any>>();
    private readonly deferredTimers = new Map<string, NodeJS.Timeout>();
    private readonly pendingStimuli = new Map<string, AgentStimulus<any>>();
    private readonly completionStimuli = new Map<string, AgentStimulus<any>>();
    private readonly deferredReady = new Set<string>();
    private disposed = false;

    constructor(
        private readonly ctx: Context,
        private readonly config: AgentBehaviorConfig,
        private readonly taskCallback: TaskCallback,
        logging: LoggerService,
        private readonly observe?: (stimulus: AgentStimulus<any>, stage: string, reason?: string) => void,
    ) {
        this.logger = logging.getLogger("[刺激调度器]");
    }

    public isBusy(channelKey: string): boolean {
        return this.runningTasks.has(channelKey) || this.deferredTimers.has(channelKey);
    }

    public schedule(stimulus: AgentStimulus<any>): void {
        if (this.disposed) {
            this.observe?.(stimulus, "cancelled", "disposed");
            return;
        }
        const { channelCid: channelKey, type } = stimulus;

        if (type === "background_task_completion") {
            this.retainCompletion(stimulus);
            this.drainCompletion(channelKey);
            return;
        }

        if (this.runningTasks.has(channelKey)) {
            this.logger.warn(`[${channelKey}] 频道正忙，将根据策略处理新刺激 [${type}]。`);
            if (type === "user_message") {
                this.handleBusyChannel(stimulus);
            } else this.observe?.(stimulus, "skipped", "busy");
            return;
        }

        if (this.deferredTimers.has(channelKey)) {
            if (type === "user_message") {
                if (this.replaceSkipped(stimulus)) this.observe?.(stimulus, "deferred", "busy");
                this.setupDeferredTimer(channelKey);
                return;
            }
            // 系统任务优先执行，积压消息在它结束后重新等待安静期。
            clearTimeout(this.deferredTimers.get(channelKey));
            this.deferredTimers.delete(channelKey);
        }

        if (type === "user_message") {
            const skipped = this.skippedStimulus.get(channelKey);
            if (skipped && skipped !== stimulus) this.observe?.(skipped, "cancelled", "debounce_replaced");
            this.skippedStimulus.delete(channelKey);
        }

        const schedulingStack = new Error("Scheduling context stack").stack;

        // 将堆栈传递给任务
        this.getDebouncedTask(channelKey, schedulingStack)(stimulus);
    }

    private getDebouncedTask(channelKey: string, schedulingStack?: string): WithDispose<(stimulus: AgentStimulus<any>) => void> {
        let debouncedTask = this.debouncedReplyTasks.get(channelKey);
        if (!debouncedTask) {
            debouncedTask = this.ctx.debounce(
                (stimulus: AgentStimulus<any>) => this.executeTask(channelKey, stimulus, schedulingStack),
                this.config.debounceMs,
            );
            this.debouncedReplyTasks.set(channelKey, debouncedTask);
        }
        // 跟踪防抖替代结果，不改变调度时序。
        const tracked = ((stimulus: AgentStimulus<any>) => {
            const old = this.pendingStimuli.get(channelKey);
            if (this.keepMention(old, stimulus)) return;
            if (old && old !== stimulus) this.observe?.(old, "cancelled", "debounce_replaced");
            this.pendingStimuli.set(channelKey, stimulus);
            this.observe?.(stimulus, "debounced");
            debouncedTask(stimulus);
        }) as WithDispose<(stimulus: AgentStimulus<any>) => void>;
        tracked.dispose = () => debouncedTask.dispose();
        return tracked;
    }

    public cancel(channelKey: string, reason = "reply_suppressed"): void {
        const pending = this.pendingStimuli.get(channelKey);
        const skipped = this.skippedStimulus.get(channelKey);
        if (pending) this.observe?.(pending, "cancelled", reason);
        if (skipped) this.observe?.(skipped, "cancelled", reason);
        const completion = this.completionStimuli.get(channelKey);
        if (completion) this.observe?.(completion, "cancelled", reason);
        this.completionStimuli.delete(channelKey);
        this.deferredReady.delete(channelKey);
        this.pendingStimuli.delete(channelKey);
        this.debouncedReplyTasks.get(channelKey)?.dispose();
        this.debouncedReplyTasks.delete(channelKey);
        this.skippedStimulus.delete(channelKey);
        const timer = this.deferredTimers.get(channelKey);
        if (timer) clearTimeout(timer);
        this.deferredTimers.delete(channelKey);
    }

    private async executeTask(channelKey: string, stimulus: AgentStimulus<any>, schedulingStack?: string): Promise<void> {
        if (this.pendingStimuli.get(channelKey) === stimulus) this.pendingStimuli.delete(channelKey);
        if (this.disposed) return;
        if (this.runningTasks.has(channelKey)) {
            if (stimulus.type === "user_message") this.handleBusyChannel(stimulus);
            else if (stimulus.type === "background_task_completion") this.retainCompletion(stimulus);
            return;
        }
        this.runningTasks.add(channelKey);
        this.observe?.(stimulus, "running");
        this.logger.debug(`[${channelKey}] 锁定频道并开始执行任务`);
        try {
            await this.taskCallback(stimulus);
        } catch (error) {
            this.observe?.(stimulus, "failed", "exception");
            // 创建错误时附加调度堆栈
            const taskError = new AppError(ErrorDefinitions.TASK.EXECUTION_FAILED, {
                cause: error as Error,
                context: {
                    channelCid: channelKey,
                    stimulusType: stimulus.type,
                    schedulingStack: schedulingStack,
                },
            });
            handleError(this.logger, taskError, `调度任务执行失败 (Channel: ${channelKey})`);
        } finally {
            this.runningTasks.delete(channelKey);
            this.logger.debug(`[${channelKey}] 频道锁已释放`);
            if (!this.disposed) {
                this.handleSkippedMessagesAfterReply(channelKey);
                this.drainCompletion(channelKey);
            }
        }
    }

    public dispose(): void {
        this.disposed = true;
        for (const stimulus of this.pendingStimuli.values()) this.observe?.(stimulus, "cancelled", "disposed");
        for (const stimulus of this.skippedStimulus.values()) this.observe?.(stimulus, "cancelled", "disposed");
        for (const stimulus of this.completionStimuli.values()) this.observe?.(stimulus, "cancelled", "disposed");
        this.debouncedReplyTasks.forEach((task) => task.dispose());
        this.deferredTimers.forEach((timer) => clearTimeout(timer));
        this.debouncedReplyTasks.clear();
        this.deferredTimers.clear();
        this.skippedStimulus.clear();
        this.pendingStimuli.clear();
        this.completionStimuli.clear();
        this.deferredReady.clear();
    }

    private retainCompletion(stimulus: AgentStimulus<any>): void {
        const old = this.completionStimuli.get(stimulus.channelCid);
        const limit = this.config.backgroundTools?.maxRetained ?? 128;
        const taskIds = [...new Set([...(old?.payload?.taskIds ?? []), ...(stimulus.payload?.taskIds ?? [])])].slice(-limit);
        this.completionStimuli.set(stimulus.channelCid, { ...stimulus, payload: { ...stimulus.payload, taskIds } });
        this.observe?.(stimulus, "queued", "background_completion");
    }

    private drainCompletion(channelKey: string): void {
        if (this.disposed || this.runningTasks.has(channelKey) || this.pendingStimuli.has(channelKey)) return;
        const completion = this.completionStimuli.get(channelKey);
        if (!completion) return;
        this.completionStimuli.delete(channelKey);
        void this.executeTask(channelKey, completion);
    }

    /** 所有用户消息都影响安静期，包括未触发回复的消息。 */
    public noteUserMessage(channelKey: string): void {
        if (!this.disposed && (this.deferredTimers.has(channelKey) || this.deferredReady.has(channelKey))) {
            this.setupDeferredTimer(channelKey);
        }
    }

    private handleBusyChannel(stimulus: AgentStimulus<any>) {
        const { channelCid: channelKey } = stimulus;

        const strategy = this.config.newMessageStrategy;
        this.logger.debug(`[${channelKey}] 频道正忙，采用策略: ${strategy}`);

        switch (strategy) {
            case "immediate":
                // 策略2：记录被跳过的刺激，待当前任务完成后立即处理
                if (!this.replaceSkipped(stimulus)) return;
                this.observe?.(stimulus, "queued", "busy");
                this.logger.debug(`[${channelKey}] 消息已记录，将在当前任务完成后立即处理`);
                break;

            case "deferred":
                // 策略3：记录被跳过的刺激，设置延迟处理定时器
                if (!this.replaceSkipped(stimulus)) return;
                this.observe?.(stimulus, "queued", "busy");
                this.logger.debug(`[${channelKey}] 消息已记录，将在任务完成后开始延迟计时`);
                break;

            case "skip":
            default:
                // 策略1：直接跳过（默认行为）
                this.logger.debug(`[${channelKey}] 跳过处理（策略: skip）`);
                this.observe?.(stimulus, "skipped", "busy");
                break;
        }
    }

    private keepMention(old: AgentStimulus<any> | undefined, incoming: AgentStimulus<any>): boolean {
        if (
            this.config.prioritizeMentions &&
            old?.type === "user_message" &&
            incoming.type === "user_message" &&
            isBotMention(old.session) &&
            !isBotMention(incoming.session)
        ) {
            this.observe?.(incoming, "skipped", "mention_priority");
            return true;
        }
        return false;
    }

    private replaceSkipped(stimulus: AgentStimulus<any>): boolean {
        const old = this.skippedStimulus.get(stimulus.channelCid);
        if (this.keepMention(old, stimulus)) return false;
        if (old && old !== stimulus) this.observe?.(old, "cancelled", "debounce_replaced");
        this.skippedStimulus.set(stimulus.channelCid, stimulus);
        return true;
    }

    private handleSkippedMessagesAfterReply(channelKey: string) {
        if (this.deferredReady.delete(channelKey) && this.skippedStimulus.has(channelKey)) {
            const stimulus = this.skippedStimulus.get(channelKey)!;
            this.skippedStimulus.delete(channelKey);
            void this.executeTask(channelKey, stimulus);
            return;
        }
        if (this.config.newMessageStrategy === "immediate" && this.skippedStimulus.has(channelKey)) {
            const skippedStimulus = this.skippedStimulus.get(channelKey);
            this.skippedStimulus.delete(channelKey);

            // 清除策略3的定时器（如果有）
            if (this.deferredTimers.has(channelKey)) {
                clearTimeout(this.deferredTimers.get(channelKey));
                this.deferredTimers.delete(channelKey);
            }

            // 防抖期间仍可合并新消息，真正开始执行时才获取频道锁。
            this.logger.debug(`[${channelKey}] 调度被跳过的段落`);

            this.getDebouncedTask(channelKey)(skippedStimulus!);
        } else if (this.config.newMessageStrategy === "deferred" && this.skippedStimulus.has(channelKey)) {
            // 任务完成后才启动定时器
            if (!this.deferredTimers.has(channelKey)) this.setupDeferredTimer(channelKey);
        }
    }

    /**
     * 设置延迟处理定时器（策略3）
     */
    private setupDeferredTimer(channelKey: string) {
        this.deferredReady.delete(channelKey);
        const waiting = this.skippedStimulus.get(channelKey);
        if (waiting) this.observe?.(waiting, "deferred", "busy");
        // 清除现有定时器
        if (this.deferredTimers.has(channelKey)) {
            clearTimeout(this.deferredTimers.get(channelKey));
            this.deferredTimers.delete(channelKey);
        }

        const timer = setTimeout(() => {
            this.deferredTimers.delete(channelKey);
            if (this.disposed) return;
            if (this.runningTasks.has(channelKey)) {
                this.deferredReady.add(channelKey);
                return;
            }
            this.logger.debug(`[${channelKey}] 延迟处理定时器触发`);
            if (this.skippedStimulus.has(channelKey)) {
                const stimulus = this.skippedStimulus.get(channelKey)!;
                this.skippedStimulus.delete(channelKey);

                // 安静期已完成消息合并，直接获取执行锁，避免再次防抖造成覆盖或并发。
                void this.executeTask(channelKey, stimulus);
            }
        }, this.config.deferredProcessingTime || 10000);

        this.deferredTimers.set(channelKey, timer);
        this.logger.debug(`[${channelKey}] 延迟定时器启动，等待 ${this.config.deferredProcessingTime}ms`);
    }
}
