import { randomUUID } from "node:crypto";

export type BackgroundTaskState = "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
export type BackgroundTaskOutcome = "succeeded" | "failed" | "cancelled";
export interface TaskSnapshot {
    id: string;
    requestId: string;
    tool: string;
    state: BackgroundTaskState;
    createdAt: number;
    updatedAt: number;
    progress?: string;
    result?: unknown;
    error?: string;
}
export interface BackgroundTaskSettlement {
    owner: string;
    requestId: string;
    taskIds: string[];
    outcome: BackgroundTaskOutcome;
}
interface RequestGroup {
    owner: string;
    requestId: string;
    tasks: Set<string>;
    sealed: boolean;
    settled: boolean;
    invalid: boolean;
}
interface Task {
    owner: string;
    snapshot: TaskSnapshot;
    group: RequestGroup;
    controller: AbortController;
    valid?: () => boolean;
    hidden: boolean;
    timeout?: ReturnType<typeof setTimeout>;
    cancellation?: { outcome: "failed" | "cancelled"; reason: string };
}
interface RegistryOptions {
    maxConcurrent: number;
    maxRetained: number;
    timeoutMs: number;
    settlement: "task" | "request";
}
function terminal(task: Task): boolean {
    return task.snapshot.state !== "running" && task.snapshot.state !== "cancelling";
}
function copyResult(value: unknown): unknown {
    try {
        return structuredClone(value);
    } catch {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return String(value);
        }
    }
}

/** In-memory execution ownership, cancellation and bounded result retention. */
export class BackgroundTaskRegistry {
    private readonly tasks = new Map<string, Task>();
    private readonly groups = new Map<string, Map<string, RequestGroup>>();
    private active = 0;
    private disposed = false;

    constructor(
        private readonly options: RegistryOptions,
        private readonly onSettlement?: (event: BackgroundTaskSettlement) => void | Promise<void>,
    ) {}

    start(
        owner: string,
        requestId: string,
        tool: string,
        execute: (signal: AbortSignal, report: (progress: string) => void) => Promise<unknown>,
        valid?: () => boolean,
    ): TaskSnapshot {
        if (this.disposed) throw new Error("Background task registry is disposed");
        this.refresh();
        let group = this.groups.get(owner)?.get(requestId);
        if (group?.sealed) throw new Error("Background request is already sealed");
        if (valid && !this.checkValid(valid)) throw new Error("Background task authorization is no longer valid");
        if (this.active >= this.options.maxConcurrent) throw new Error("Background task concurrency limit reached");
        this.makeRoom();
        // Pruning the last task may also have removed this request's group.
        group = this.groups.get(owner)?.get(requestId);
        if (!group) {
            group = { owner, requestId, tasks: new Set(), sealed: false, settled: false, invalid: false };
            let requests = this.groups.get(owner);
            if (!requests) this.groups.set(owner, (requests = new Map()));
            requests.set(requestId, group);
        }
        const now = Date.now();
        const task: Task = {
            owner,
            group,
            controller: new AbortController(),
            valid,
            hidden: false,
            snapshot: { id: randomUUID(), requestId, tool, state: "running", createdAt: now, updatedAt: now },
        };
        this.tasks.set(task.snapshot.id, task);
        group.tasks.add(task.snapshot.id);
        this.active++;
        task.timeout = setTimeout(() => this.requestCancellation(task, "Background task timeout", "failed"), this.options.timeoutMs);
        task.timeout.unref?.();
        // Both synchronous execution errors and asynchronous rejections use the same settlement path.
        void Promise.resolve()
            .then(() => {
                if (!this.current(task)) return undefined;
                return execute(task.controller.signal, (progress) => {
                    if (!this.current(task) || task.snapshot.state !== "running") return;
                    task.snapshot.progress = String(progress).slice(0, 300);
                    task.snapshot.updatedAt = Date.now();
                });
            })
            .then(
                (result) => this.finish(task, "succeeded", result),
                (error: unknown) => this.finish(task, "failed", undefined, error),
            );
        return this.snapshot(task);
    }
    sealRequest(owner: string, requestId: string): void {
        if (this.disposed) return;
        const group = this.groups.get(owner)?.get(requestId);
        if (!group) return;
        group.sealed = true;
        this.settleGroup(group);
    }
    query(owner: string, id: string): TaskSnapshot {
        return this.snapshot(this.owned(owner, id));
    }
    list(owner: string, limit = 8): TaskSnapshot[] {
        this.refresh();
        const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 8;
        return [...this.tasks.values()]
            .reverse()
            .filter((task) => task.owner === owner && !task.hidden)
            .slice(0, count)
            .map((task) => {
                const { result: _result, error, ...summary } = task.snapshot;
                return { ...summary, ...(error === undefined ? {} : { error: error.slice(0, 500) }) };
            });
    }
    cancel(owner: string, id: string, reason = "Background task cancelled"): TaskSnapshot {
        const task = this.owned(owner, id);
        this.requestCancellation(task, reason, "cancelled");
        return this.snapshot(task);
    }
    invalidate(owner: string, reason = "Background task authorization invalidated"): void {
        for (const task of this.tasks.values()) if (task.owner === owner) this.hide(task, reason);
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const task of this.tasks.values()) {
            task.hidden = true;
            task.group.invalid = true;
            clearTimeout(task.timeout);
            task.controller.abort(new Error("Background task registry disposed"));
        }
        this.tasks.clear();
        this.groups.clear();
    }
    isCurrent(owner: string, id: string): boolean {
        const task = this.tasks.get(id);
        return !!task && task.owner === owner && this.current(task);
    }
    private checkValid(valid: () => boolean): boolean {
        try {
            return valid();
        } catch {
            return false;
        }
    }
    private current(task: Task): boolean {
        if (this.disposed || task.hidden) return false;
        if (task.valid && !this.checkValid(task.valid)) this.hide(task, "Background task authorization invalidated");
        return !task.hidden;
    }
    private refresh(): void {
        for (const task of this.tasks.values()) this.current(task);
    }
    private owned(owner: string, id: string): Task {
        const task = this.tasks.get(id);
        if (!task || task.owner !== owner || !this.current(task)) throw new Error("Background task not found");
        return task;
    }
    private snapshot(task: Task): TaskSnapshot {
        const snapshot = { ...task.snapshot };
        if ("result" in snapshot) snapshot.result = copyResult(snapshot.result);
        return snapshot;
    }
    private requestCancellation(task: Task, reason: string, outcome: "failed" | "cancelled"): void {
        if (terminal(task) || task.cancellation || this.disposed) return;
        task.cancellation = { outcome, reason };
        task.snapshot.state = "cancelling";
        task.snapshot.updatedAt = Date.now();
        clearTimeout(task.timeout);
        task.controller.abort(new Error(reason));
    }
    private hide(task: Task, reason: string): void {
        if (task.hidden) return;
        task.hidden = true;
        task.group.invalid = true;
        this.requestCancellation(task, reason, "cancelled");
        if (terminal(task)) this.remove(task);
    }
    private finish(task: Task, outcome: "succeeded" | "failed", result?: unknown, error?: unknown): void {
        this.active--;
        clearTimeout(task.timeout);
        if (!this.current(task)) {
            this.remove(task);
            return;
        }
        if (task.cancellation) {
            task.snapshot.state = task.cancellation.outcome;
            task.snapshot.error = task.cancellation.reason;
        } else {
            task.snapshot.state = outcome;
            if (outcome === "succeeded") task.snapshot.result = copyResult(result);
            else task.snapshot.error = error instanceof Error ? error.message : String(error);
        }
        task.snapshot.updatedAt = Date.now();
        if (this.options.settlement === "task" && !task.group.invalid)
            this.emit({
                owner: task.owner,
                requestId: task.snapshot.requestId,
                taskIds: [task.snapshot.id],
                outcome: task.snapshot.state as BackgroundTaskOutcome,
            });
        this.settleGroup(task.group);
    }
    private settleGroup(group: RequestGroup): void {
        if (!group.sealed || group.settled) return;
        const tasks = [...group.tasks].map((id) => this.tasks.get(id)).filter((task): task is Task => !!task);
        for (const task of tasks) this.current(task);
        if (tasks.some((task) => !terminal(task))) return;
        group.settled = true;
        if (this.options.settlement !== "request" || group.invalid || !tasks.length) return;
        const states = tasks.map((task) => task.snapshot.state);
        const outcome = states.includes("failed") ? "failed" : states.includes("cancelled") ? "cancelled" : "succeeded";
        this.emit({ owner: group.owner, requestId: group.requestId, taskIds: [...group.tasks], outcome });
    }
    private emit(event: BackgroundTaskSettlement): void {
        if (this.disposed || !this.onSettlement) return;
        try {
            void Promise.resolve(this.onSettlement(event)).catch(() => {});
        } catch {
            /* Completion callbacks cannot fail execution settlement. */
        }
    }
    private makeRoom(): void {
        while (this.tasks.size >= this.options.maxRetained) {
            const removable = [...this.tasks.values()].find(
                (task) => terminal(task) && (this.options.settlement === "task" || task.group.settled || task.hidden),
            );
            if (!removable) throw new Error("Background task retained history limit reached");
            this.remove(removable);
        }
    }
    private remove(task: Task): void {
        this.tasks.delete(task.snapshot.id);
        task.group.tasks.delete(task.snapshot.id);
        if (task.group.tasks.size) return;
        const requests = this.groups.get(task.owner);
        requests?.delete(task.snapshot.requestId);
        if (!requests?.size) this.groups.delete(task.owner);
    }
}
