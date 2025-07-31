import { Context } from "koishi";

import { AgentStimulus } from "@/services/worldstate";
import { Services } from "@/shared/constants";
import { handleError } from "@/shared/errors";
import { AgentBehaviorConfig } from "./config";

type TaskCallback = (stimulus: AgentStimulus<any>) => Promise<any>;
type WithDispose<T> = T & { dispose: () => void };

/**
 * @description 负责调度 Agent 刺激的处理。
 * 它管理并发、防抖以及在频道繁忙时根据策略处理新消息。
 */
export class StimulusScheduler {
    private readonly logger;
    private readonly runningTasks = new Set<string>();
    private readonly debouncedReplyTasks = new Map<string, WithDispose<(stimulus: AgentStimulus<any>) => void>>();
    private readonly skippedStimulus = new Map<string, AgentStimulus<any>>();
    private readonly deferredTimers = new Map<string, NodeJS.Timeout>();

    constructor(
        private readonly ctx: Context,
        private readonly config: AgentBehaviorConfig,
        private readonly taskCallback: TaskCallback
    ) {
        this.logger = ctx[Services.Logger].getLogger("[刺激调度器]");
    }

    public schedule(stimulus: AgentStimulus<any>): void {
        const { channelCid: channelKey, type, priority } = stimulus;

        if (this.runningTasks.has(channelKey)) {
            this.logger.warn(`[${channelKey}] 频道正忙，将根据策略处理新刺激 [${type}]。`);
            if (type === "user_message") {
                this.handleBusyChannel(stimulus);
            }
            return;
        }

        // 简化：所有刺激都通过防抖任务来启动，以统一入口点
        this.getDebouncedTask(channelKey)(stimulus);
    }

    private getDebouncedTask(channelKey: string): WithDispose<(stimulus: AgentStimulus<any>) => void> {
        let debouncedTask = this.debouncedReplyTasks.get(channelKey);
        if (!debouncedTask) {
            debouncedTask = this.ctx.debounce(async (stimulus: AgentStimulus<any>) => {
                this.runningTasks.add(channelKey);
                this.logger.debug(`[${channelKey}] 锁定频道并开始执行任务。`);
                try {
                    await this.taskCallback(stimulus);
                } catch (error) {
                    handleError(this.logger, error, `调度任务执行失败 (Channel: ${channelKey})`);
                } finally {
                    this.runningTasks.delete(channelKey);
                    this.logger.debug(`[${channelKey}] 频道锁已释放`);
                    this.handleSkippedMessagesAfterReply(channelKey);
                }
            }, this.config.arousal.debounceMs);
            this.debouncedReplyTasks.set(channelKey, debouncedTask);
        }
        return debouncedTask;
    }

    public dispose(): void {
        this.debouncedReplyTasks.forEach((task) => task.dispose());
        this.deferredTimers.forEach((timer) => clearTimeout(timer));
    }

    private handleBusyChannel(stimulus: AgentStimulus<any>) {
        const { channelCid: channelKey } = stimulus;

        const strategy = this.config.newMessageStrategy;
        this.logger.debug(`[${channelKey}] 频道正忙，采用策略: ${strategy}`);

        switch (strategy) {
            case "immediate":
                // 策略2：记录被跳过的刺激，待当前任务完成后立即处理
                this.skippedStimulus.set(channelKey, stimulus);
                this.logger.debug(`[${channelKey}] 消息已记录，将在当前任务完成后立即处理`);
                break;

            case "deferred":
                // 策略3：记录被跳过的刺激，设置延迟处理定时器
                this.skippedStimulus.set(channelKey, stimulus);
                this.logger.debug(`[${channelKey}] 消息已记录，将在任务完成后开始延迟计时`);
                break;

            case "skip":
            default:
                // 策略1：直接跳过（默认行为）
                this.logger.debug(`[${channelKey}] 跳过处理（策略: skip）`);
                break;
        }
    }

    private handleSkippedMessagesAfterReply(channelKey: string) {
        if (this.config.newMessageStrategy === "immediate" && this.skippedStimulus.has(channelKey)) {
            const skippedStimulus = this.skippedStimulus.get(channelKey);
            this.skippedStimulus.delete(channelKey);

            // 清除策略3的定时器（如果有）
            if (this.deferredTimers.has(channelKey)) {
                clearTimeout(this.deferredTimers.get(channelKey));
                this.deferredTimers.delete(channelKey);
            }

            // 重新获取频道锁
            this.runningTasks.add(channelKey);
            this.logger.debug(`[${channelKey}] 立即处理被跳过的段落（重新锁定频道）`);

            const debouncedTask = this.debouncedReplyTasks.get(channelKey);
            if (debouncedTask) {
                debouncedTask(skippedStimulus);
            }
        } else if (this.config.newMessageStrategy === "deferred" && this.skippedStimulus.has(channelKey)) {
            // 任务完成后才启动定时器
            this.setupDeferredTimer(channelKey);
        }
    }

    /**
     * 设置延迟处理定时器（策略3）
     */
    private setupDeferredTimer(channelKey: string) {
        // 清除现有定时器
        if (this.deferredTimers.has(channelKey)) {
            clearTimeout(this.deferredTimers.get(channelKey));
            this.deferredTimers.delete(channelKey);
        }

        const timer = setTimeout(() => {
            this.logger.debug(`[${channelKey}] 延迟处理定时器触发`);
            if (this.skippedStimulus.has(channelKey)) {
                const stimulus = this.skippedStimulus.get(channelKey);
                this.skippedStimulus.delete(channelKey);

                this.runningTasks.add(channelKey);
                this.logger.debug(`[${channelKey}] 处理被跳过的段落（重新锁定频道）`);

                // 获取防抖任务并执行
                const debouncedTask = this.debouncedReplyTasks.get(channelKey);
                if (debouncedTask) {
                    this.logger.debug(`[${channelKey}] 处理被跳过的段落`);
                    debouncedTask(stimulus);
                }
            }
            this.deferredTimers.delete(channelKey);
        }, this.config.deferredProcessingTime || 10000);

        this.deferredTimers.set(channelKey, timer);
        this.logger.debug(`[${channelKey}] 延迟定时器启动，等待 ${this.config.deferredProcessingTime}ms`);
    }
}
