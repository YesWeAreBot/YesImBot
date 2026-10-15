import { createHash } from "node:crypto";

import type { Context } from "koishi";

export const TABLE = "yesimbot.durable_tasks";
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export interface TaskTarget {
    platform: string;
    selfId: string;
    channelId: string;
    requester: string;
    guildId: string;
    isDirect: boolean;
}
export interface ReminderInput extends TaskTarget {
    deadline: number;
    content: string;
    idempotencyKey: string;
}
export interface DurableTask extends ReminderInput {
    id: string;
    owner: string;
    status: TaskStatus;
    error: string;
    createdAt: number;
    updatedAt: number;
}
declare module "koishi" {
    interface Tables {
        "yesimbot.durable_tasks": DurableTask;
    }
}
export function registerModels(ctx: Context) {
    ctx.model.extend(
        TABLE,
        {
            id: "string(64)",
            owner: "string(64)",
            platform: "string",
            selfId: "string",
            channelId: "string",
            requester: "string",
            guildId: "string",
            isDirect: "boolean",
            deadline: "double",
            content: "text",
            idempotencyKey: "string(128)",
            status: "string(16)",
            error: "string(128)",
            createdAt: "double",
            updatedAt: "double",
        },
        { primary: "id" },
    );
}
export const taskOwner = (coreScope: string, pluginScope: string) =>
    createHash("sha256")
        .update(JSON.stringify([coreScope, pluginScope]))
        .digest("hex");

export class TaskStore {
    constructor(
        private readonly db: Context["database"],
        public readonly owner: string,
    ) {}
    public async enqueue(input: ReminderInput, now = Date.now()): Promise<DurableTask> {
        for (const field of ["platform", "selfId", "channelId", "requester"] as const) {
            if (typeof input[field] !== "string" || !input[field] || input[field].length > 256) throw new Error(`Invalid target ${field}`);
        }
        if (!Number.isSafeInteger(input.deadline) || input.deadline < now || input.deadline - now > 366 * 86400_000)
            throw new Error("Invalid deadline (must be within the next 366 days)");
        if (typeof input.content !== "string" || !input.content.trim() || input.content.length > 2000) throw new Error("Invalid content (1–2000 characters)");
        if (typeof input.idempotencyKey !== "string" || !input.idempotencyKey.trim() || input.idempotencyKey.length > 128)
            throw new Error("Invalid idempotency key");
        const id = createHash("sha256")
            .update(
                JSON.stringify([
                    this.owner,
                    input.platform,
                    input.selfId,
                    input.channelId,
                    input.isDirect,
                    input.guildId,
                    input.requester,
                    input.idempotencyKey,
                ]),
            )
            .digest("hex");
        const existing = await this.get(id);
        if (existing) return existing;
        const row: DurableTask = { ...input, id, owner: this.owner, status: "queued", error: "", createdAt: now, updatedAt: now };
        try {
            return await this.db.create(TABLE, row);
        } catch (error) {
            // SQL primary-key uniqueness arbitrates concurrent duplicate submissions.
            const duplicate = await this.get(id);
            if (duplicate) return duplicate;
            throw error;
        }
    }
    public async get(id: string): Promise<DurableTask | undefined> {
        return (await this.db.get(TABLE, { id, owner: this.owner }))[0];
    }
    public list(target?: Pick<TaskTarget, "platform" | "selfId" | "channelId" | "isDirect" | "guildId">): Promise<DurableTask[]> {
        return this.db.get(
            TABLE,
            {
                owner: this.owner,
                ...(target
                    ? { platform: target.platform, selfId: target.selfId, channelId: target.channelId, isDirect: target.isDirect, guildId: target.guildId }
                    : {}),
            },
            { sort: { createdAt: "desc" }, limit: 100 },
        );
    }
    public due(now: number): Promise<DurableTask[]> {
        return this.db.get(TABLE, { owner: this.owner, status: "queued", deadline: { $lte: now } }, { sort: { deadline: "asc" }, limit: 20 });
    }
    public async claim(id: string): Promise<boolean> {
        return !!(await this.db.set(TABLE, { id, owner: this.owner, status: "queued" }, { status: "running", updatedAt: Date.now() })).matched;
    }
    public async complete(id: string): Promise<boolean> {
        return !!(await this.db.set(TABLE, { id, owner: this.owner, status: "running" }, { status: "completed", error: "", updatedAt: Date.now() })).matched;
    }
    public async fail(id: string, error: string): Promise<void> {
        await this.db.set(TABLE, { id, owner: this.owner, status: "running" }, { status: "failed", error: error.slice(0, 128), updatedAt: Date.now() });
    }
    public async cancel(id: string): Promise<boolean> {
        return !!(
            await this.db.set(
                TABLE,
                { id, owner: this.owner, $or: [{ status: "queued" }, { status: "running" }] },
                { status: "cancelled", updatedAt: Date.now() },
            )
        ).matched;
    }
    public async retry(id: string, deadline: number): Promise<boolean> {
        if (!Number.isSafeInteger(deadline) || deadline < 0) throw new Error("Invalid deadline");
        return !!(await this.db.set(TABLE, { id, owner: this.owner, status: "failed" }, { status: "queued", error: "", deadline, updatedAt: Date.now() }))
            .matched;
    }
    public async recover(): Promise<void> {
        await this.db.set(TABLE, { owner: this.owner, status: "running" }, { status: "failed", error: "interrupted_requires_retry", updatedAt: Date.now() });
    }
}
