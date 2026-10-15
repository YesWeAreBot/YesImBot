import type { Session } from "koishi";

import { type DurableTask, TaskStore } from "./store";

export interface TaskDelivery {
    prepare(task: DurableTask): Promise<{ session: Session; ownerId: string } | { error: string }>;
    dispatch(session: Session, task: DurableTask, ownerId: string): void | Promise<void>;
}
/** completed 表示唤醒已投递给 Agent，不是消息发送回执。 */
export class TaskWorker {
    private stopped = false;
    private pending?: Promise<void>;
    constructor(
        private readonly store: TaskStore,
        private readonly delivery: TaskDelivery,
    ) {}
    public async start(): Promise<void> {
        await this.store.recover();
    }
    public stop(): void {
        this.stopped = true;
    }
    public tick(now = Date.now()): Promise<void> {
        if (this.stopped) return Promise.resolve();
        if (this.pending) return this.pending;
        const pending = this.run(now);
        this.pending = pending;
        void pending
            .finally(() => {
                if (this.pending === pending) this.pending = undefined;
            })
            .catch(() => {});
        return pending;
    }
    private async run(now: number): Promise<void> {
        for (const task of await this.store.due(now)) {
            if (this.stopped) return;
            if (!(await this.store.claim(task.id))) continue;
            if (this.stopped) return;
            try {
                const delivery = await this.delivery.prepare(task);
                if (this.stopped) return;
                if ("error" in delivery) {
                    await this.store.fail(task.id, delivery.error);
                    continue;
                }
                // 管理员可以在异步权限校验期间取消；迟到校验不能重新投递。
                if ((await this.store.get(task.id))?.status !== "running") continue;
                if (this.stopped) return;
                await this.delivery.dispatch(delivery.session, task, delivery.ownerId);
                await this.store.complete(task.id);
            } catch {
                // 可能已投递；失败状态不会自动重试外部副作用。
                await this.store.fail(task.id, "dispatch_failed_requires_retry");
            }
        }
    }
}
