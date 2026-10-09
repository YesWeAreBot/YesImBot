import { createHash } from "node:crypto";

import type { Context } from "koishi";

import { accountRef, sceneKey, type Account, type Person, type PersonStore, type SceneInput, type Evidence, type State } from "./store";

export interface RecallTarget {
    platform: string;
    selfId: string;
    channelId: string;
    isDirect?: boolean;
    userId?: string;
    guildId?: string;
}
export interface Experience extends RecallTarget {
    id: string;
    scope: string;
    messageId: string;
    userId: string;
    account: string;
    name: string;
    content: string;
    personId: string;
    bindingRevision: number;
    timestamp: number;
}
interface SceneRow extends RecallTarget {
    id: string;
    scope: string;
}
const EXPERIENCES = "person_memory.experiences",
    SCENES = "person_memory.scenes";
declare module "koishi" {
    interface Tables {
        "person_memory.experiences": Experience;
        "person_memory.scenes": SceneRow;
    }
}
export function registerContinuityModels(ctx: Context) {
    ctx.model.extend(
        EXPERIENCES,
        {
            id: "string",
            scope: "string",
            platform: "string",
            selfId: "string",
            channelId: "string",
            guildId: "string",
            isDirect: "boolean",
            messageId: "string",
            userId: "string",
            account: "string",
            name: "string",
            content: "text",
            personId: "string",
            bindingRevision: "unsigned",
            timestamp: "double",
        },
        { primary: "id" },
    );
    ctx.model.extend(
        SCENES,
        {
            id: "string",
            scope: "string",
            platform: "string",
            selfId: "string",
            channelId: "string",
            isDirect: "boolean",
            userId: "string",
            guildId: "string",
        },
        { primary: "id" },
    );
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function sourceRef(session: SceneInput, messageId: string): string {
    return `source:${hash([sceneKey(session), messageId])}`;
}
export function recallTokens(query: string): string[] {
    if (typeof query !== "string" || !query.trim() || query.length > 160) throw new Error("请提供 1–160 字的回忆关键词");
    const words = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    return [
        ...new Set(
            words.flatMap((word) =>
                /^[\u3400-\u9fff]+$/.test(word) && word.length > 2
                    ? [word, ...Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))]
                    : [word],
            ),
        ),
    ].slice(0, 24);
}
export function keywordScore(content: string, tokens: string[]): number {
    const text = content.toLocaleLowerCase();
    return tokens.reduce((score, token) => score + (text.includes(token) ? token.length : 0), 0);
}
export interface RecallOptions {
    query: string;
    personId?: string;
    targets?: RecallTarget[];
    start?: number;
    end?: number;
    limit?: number;
}
export class ContinuityStore {
    constructor(
        private db: Context["database"],
        private people: PersonStore,
    ) {}
    async capture(scope: string, session: SceneInput, source: Evidence, identity: { person: Person; account: Account }, active = () => true) {
        const selfId = session.selfId || session.bot!.selfId;
        const location = {
            platform: session.platform,
            selfId,
            channelId: session.channelId,
            isDirect: !!session.isDirect,
            userId: session.userId,
            guildId: (session as SceneInput & { guildId?: string }).guildId,
        };
        if (!active()) throw new Error("任务已取消");
        await this.db.upsert(SCENES, [{ id: hash([scope, sceneKey(session)]), scope, ...location }]);
        const id = hash([scope, sceneKey(session), source.id]);
        if ((await this.db.get(EXPERIENCES, { id })).length) return;
        if (!Number.isFinite(source.timestamp) || !source.text?.trim()) return;
        const row: Experience = {
            id,
            scope,
            ...location,
            messageId: source.id,
            userId: source.userId,
            account: accountRef(session.platform, source.userId),
            name: source.name.slice(0, 80),
            content: source.text.slice(0, 4000),
            personId: identity.person.id,
            bindingRevision: identity.account.bindingRevision ?? 0,
            timestamp: source.timestamp,
        };
        if (!active()) throw new Error("任务已取消");
        try {
            await this.db.create(EXPERIENCES, row);
        } catch (error) {
            if (!(await this.db.get(EXPERIENCES, { id })).length) throw error;
        }
    }
    async scenes(scope: string): Promise<RecallTarget[]> {
        return this.db.get(SCENES, { scope });
    }
    async prune(scope: string, days: number) {
        if (days > 0) await this.db.remove(EXPERIENCES, { scope, timestamp: { $lt: Date.now() - days * 86400000 } });
    }
    async recall(scope: string, options: RecallOptions) {
        const tokens = recallTokens(options.query);
        const limit = Math.min(12, Math.max(1, Math.floor(options.limit ?? 6)));
        if (
            !Number.isFinite(limit) ||
            (options.start !== undefined && !Number.isFinite(options.start)) ||
            (options.end !== undefined && !Number.isFinite(options.end)) ||
            (options.start !== undefined && options.end !== undefined && options.start > options.end)
        )
            throw new Error("无效的回忆范围");
        if (options.targets && !options.targets.length) return { items: [], omitted: 0, candidateLimit: 200 };
        if (!tokens.length) return { items: [], omitted: 0, candidateLimit: 200 };
        const regex = new RegExp(tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
        const candidates = await this.db.get(
            EXPERIENCES,
            {
                scope,
                content: { $regex: regex },
                ...(options.personId ? { personId: options.personId } : {}),
                ...(options.start !== undefined || options.end !== undefined
                    ? {
                          timestamp: {
                              ...(options.start !== undefined ? { $gte: options.start } : {}),
                              ...(options.end !== undefined ? { $lte: options.end } : {}),
                          },
                      }
                    : {}),
                ...(options.targets
                    ? {
                          $or: options.targets.map((t) => ({
                              platform: t.platform,
                              selfId: t.selfId,
                              channelId: t.channelId,
                              isDirect: !!t.isDirect,
                              ...(t.isDirect && t.userId ? { userId: t.userId } : {}),
                          })),
                      }
                    : {}),
            },
            { limit: 200, sort: { timestamp: "desc" } },
        );
        const state = await this.people.read(scope),
            accounts = new Map(Object.values(state.accounts).map((a) => [a.userId, a]));
        const usable = candidates.filter((row) => {
            const account = accounts.get(row.account);
            return account?.personId === row.personId && (account.bindingRevision ?? 0) === row.bindingRevision;
        });
        const items = usable
            .map((row) => ({ ...row, score: keywordScore(row.content, tokens), status: "source" as const }))
            .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
            .slice(0, limit);
        return { items, omitted: candidates.length - usable.length, candidateLimit: 200 };
    }
    async summaryUnsafe(scope: string, platform: string, participants: string[], timestamp: number): Promise<boolean> {
        return summaryUnsafeIn(await this.people.read(scope), platform, participants, timestamp);
    }
}
export function summaryUnsafeIn(state: State, platform: string, participants: string[], timestamp: number): boolean {
    const before = (barrier: number | undefined) => !!barrier && (!Number.isFinite(timestamp) || timestamp <= barrier);
    if (!participants?.length) return before(state.settings.correctionAt);
    for (const id of participants) {
        const current = Object.values(state.accounts).find((a) => a.userId === accountRef(platform, id));
        const person = current && state.people[current.personId];
        if (!person ? before(state.settings.correctionAt) : before(Math.max(person.identityChangedAt ?? 0, person.memoryChangedAt ?? 0))) return true;
    }
    return false;
}
