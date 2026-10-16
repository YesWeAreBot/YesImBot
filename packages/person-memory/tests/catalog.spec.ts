import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { PeopleCatalog, type CatalogArgs } from "../src/catalog";
import type { Account, Person, State } from "../src/store";

const project = (p: Person, accounts: Account[], fields: string) => ({
    id: p.id,
    name: p.name,
    accounts: accounts.map((a) => a.userId),
    fields,
    ...(fields === "full" ? { profile: p.profile } : {}),
});

function fixture(count = 24) {
    const state: State = { people: {}, accounts: {}, proposals: {}, linkProposals: {}, settings: { mode: "review", paused: false } };
    for (let i = 0; i < count; i++) {
        const id = `p${String(i).padStart(3, "0")}`;
        state.people[id] = { id, name: `Name ${i}`, profile: `Profile ${i}`, evidence: [], provisional: false, locked: false, stale: false, revision: 1 };
        const userId = `u${i}`;
        state.accounts[createHash("sha256").update(userId).digest("hex")] = { userId, name: `Account ${i}`, personId: id, revision: 1, confidence: 1 };
    }
    const read = async () => structuredClone(state);
    const allowed = new Set(Object.keys(state.people));
    const canRead = async (p: Person) => allowed.has(p.id);
    const catalog = new PeopleCatalog();
    const query = (args: CatalogArgs, scope = "s") => catalog.query(scope, args, read, canRead, project);
    return { state, allowed, query, catalog, read, canRead, project };
}

describe("PeopleCatalog", () => {
    test("lists a deterministic unique catalog and pages all profiles without cutting any item", async () => {
        const f = fixture();
        const args: CatalogArgs = { action: "read_many", all: true, fields: "full", limit: 20 };
        const first = await f.query(args);
        expect(first.total).toBe(24);
        expect(first.returned).toBe(20);
        expect(first.hasMore).toBe(true);
        const second = await f.query({ ...args, cursor: first.nextCursor });
        expect(second.items.map((p: any) => p.id)).toEqual(["p020", "p021", "p022", "p023"]);
        expect(second.snapshotAt).toBe(first.snapshotAt);
        expect(second.hasMore).toBe(false);
        expect(second.nextCursor).toBeUndefined();
    });
    test("selects UUIDs or canonical account references and deduplicates aliases", async () => {
        const f = fixture();
        f.state.accounts.alias = { ...Object.values(f.state.accounts)[0], userId: "alias" };
        const result = await f.query({ action: "read_many", account_ids: ["p000", "u0", "alias", "u2"], fields: "structured" });
        expect(result.total).toBe(2);
        expect(result.items.map((p: any) => p.id)).toEqual(["p000", "p002"]);
        expect((result.items[0] as any).fields).toBe("structured");
    });
    test("name search is case insensitive and only lists allowed people", async () => {
        const f = fixture();
        f.allowed.delete("p001");
        const result = await f.query({ action: "list", query: "nAmE 1" });
        expect(result.items.map((p: any) => p.id)).toEqual(Array.from({ length: 10 }, (_, i) => `p0${i + 10}`));
    });
    test("rejects unknown, denied, inherited and ambiguous name selections explicitly", async () => {
        const f = fixture();
        for (const ref of ["absent", "__proto__", "constructor", "Name 0"]) {
            await expect(f.query({ action: "read_many", account_ids: ["u0", ref] })).rejects.toThrow(/unknown|不存在/);
        }
        f.allowed.delete("p001");
        await expect(f.query({ action: "read_many", account_ids: ["u0", "u1"] })).rejects.toThrow(/denied|权限/);
        await expect(f.query({ action: "read_many", all: true, account_ids: ["u0"] })).rejects.toThrow(/./);
        await expect(f.query({ action: "read_many" })).rejects.toThrow(/./);
    });
    test("invalidates snapshots after revocation, profile or account revision changes, or stale changes", async () => {
        for (const change of [
            (f: ReturnType<typeof fixture>) => f.allowed.delete("p023"),
            (f: ReturnType<typeof fixture>) => f.state.people.p023.revision++,
            (f: ReturnType<typeof fixture>) => {
                f.state.people.p023.stale = true;
            },
            (f: ReturnType<typeof fixture>) => {
                Object.values(f.state.accounts)[23].revision++;
            },
        ]) {
            const f = fixture();
            const args: CatalogArgs = { action: "read_many", all: true };
            const first = await f.query(args);
            change(f);
            await expect(f.query({ ...args, cursor: first.nextCursor })).rejects.toThrow(/restart|重新/);
        }
    });
    test("rejects a revision changed during an asynchronous permission check", async () => {
        const f = fixture(1);
        let checks = 0;
        const canRead = async () => {
            checks++;
            if (checks === 3) f.state.people.p000.revision++;
            return true;
        };
        await expect(f.catalog.query("s", { action: "list" }, f.read, canRead, f.project)).rejects.toThrow(/restart|重新/);
    });
    test("continues with cursor alone while rejecting explicit selection conflicts", async () => {
        const f = fixture();
        const first = await f.query({ action: "read_many", all: true, fields: "full" });
        const second = await f.query({ action: "read_many", cursor: first.nextCursor });
        expect(second.returned).toBe(4);
        expect((second.items[0] as any).fields).toBe("full");
        await expect(f.query({ action: "read_many", cursor: first.nextCursor, all: false })).rejects.toThrow(/./);
        await expect(f.query({ action: "list", cursor: first.nextCursor })).rejects.toThrow(/./);
    });
    test("binds cursors to scope, selection, query and fields and expires bounded snapshots", async () => {
        let now = 1000;
        const f = fixture();
        const catalog = new PeopleCatalog({ now: () => now, ttlMs: 100, maxSnapshots: 1 });
        const query = (args: CatalogArgs, scope = "s") => catalog.query(scope, args, f.read, f.canRead, f.project);
        const args: CatalogArgs = { action: "list", query: "Name" };
        const first = await query(args);
        for (const changed of [
            { ...args, fields: "full" as const },
            { ...args, query: "other" },
        ]) {
            await expect(query({ ...changed, cursor: first.nextCursor })).rejects.toThrow(/cursor|游标/);
        }
        await expect(query({ ...args, cursor: first.nextCursor }, "other")).rejects.toThrow(/cursor|游标/);
        now += 101;
        await expect(query({ ...args, cursor: first.nextCursor })).rejects.toThrow(/restart|重新/);
        const next = await query(args);
        await query(args);
        await expect(query({ ...args, cursor: next.nextCursor })).rejects.toThrow(/restart|重新/);
    });
    test("returns copied projections and never mutates source state", async () => {
        const f = fixture();
        const original = JSON.stringify(f.state);
        const args: CatalogArgs = { action: "list", limit: 1 };
        const first = await f.query(args);
        (first.items[0] as any).name = "changed";
        const repeat = await f.query({ ...args, cursor: first.nextCursor });
        expect((repeat.items[0] as any).name).toBe("Name 1");
        expect(JSON.stringify(f.state)).toBe(original);
    });
    test("limits UTF8 response bytes and fails an indivisible oversized profile", async () => {
        const f = fixture(3);
        const catalog = new PeopleCatalog({ maxBytes: 1200 });
        const args: CatalogArgs = { action: "read_many", all: true, fields: "full" };
        for (const p of Object.values(f.state.people)) p.profile = "中".repeat(160);
        const first = await catalog.query("s", args, f.read, f.canRead, f.project);
        expect(first.returned).toBe(1);
        expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(1200);
        f.state.people.p000.profile = "中".repeat(500);
        await expect(catalog.query("s", args, f.read, f.canRead, f.project)).rejects.toThrow(/large|过大/);
    });
    test("denies off mode and validates finite positive page sizes", async () => {
        const f = fixture();
        for (const limit of [0, -1, NaN, Infinity, 1.5]) await expect(f.query({ action: "list", limit })).rejects.toThrow(/./);
        f.state.settings.mode = "off";
        await expect(f.query({ action: "list" })).rejects.toThrow(/off|关闭/);
    });
});
