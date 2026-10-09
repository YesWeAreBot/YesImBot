import { describe, expect, it } from "bun:test";

import { ReplyControl, messageCategories } from "../src/agent/reply-control";

const target = { platform: "onebot", selfId: "bot", channelId: "group" };
function fixture() {
    let now = 1000;
    const rows = new Map<string, any>();
    const changes: string[] = [];
    const control = new ReplyControl(
        {
            load: async () => [...rows.values()],
            save: async (rule) => {
                rows.set(rule.id, structuredClone(rule));
            },
            remove: async (id) => {
                rows.delete(id);
            },
        },
        (t, reason) => {
            changes.push(reason);
        },
        async () => {},
        () => now,
    );
    return {
        control,
        rows,
        changes,
        advance: () => {
            now += 60000;
        },
    };
}
describe("reply suppression", () => {
    it("strict default blocks every stimulus and invalidates a running turn", async () => {
        const { control } = fixture();
        const token = control.token(target);
        await control.set(target, ["all"], 60000);
        expect(control.allowed(target, ["at"])).toEqual([]);
        expect(control.allowed(target, ["system"])).toEqual([]);
        expect(control.valid(target, token)).toBe(false);
    });
    it("matches at in a mixed message while excluding text gain", async () => {
        const { control } = fixture();
        await control.set(target, ["text", "quote", "direct", "system"], null);
        expect(control.allowed(target, ["text", "at", "quote"])).toEqual(["at"]);
        expect(messageCategories({ content: "hello", stripped: {}, elements: [{ type: "at", attrs: { id: "someone" } }] } as any)).toEqual(["text", "at"]);
    });
    it("expires from zero and never resurrects pre-pause tasks", async () => {
        const { control, advance, changes } = fixture();
        const token = control.token(target);
        await control.set(target, ["all"], 60000);
        advance();
        expect(control.get(target)).toBeUndefined();
        expect(control.valid(target, token)).toBe(false);
        expect(changes).toEqual(["pause", "expired"]);
    });
    it("replaces rules, persists permanent rules and isolates bot/platform/private", async () => {
        const { control, rows } = fixture();
        await control.set(target, ["all"], 60000);
        await control.set(target, ["text"], null);
        expect(control.get(target)?.expiresAt).toBeNull();
        expect(rows.size).toBe(1);
        expect(control.get({ ...target, selfId: "other" })).toBeUndefined();
        expect(control.get({ ...target, platform: "other" })).toBeUndefined();
        expect(control.get({ ...target, channelId: "private:group" })).toBeUndefined();
        await control.initialize();
        expect(control.get(target)?.blocked).toEqual(["text"]);
        expect(await control.resume(target)).toBe(true);
        expect(rows.size).toBe(0);
    });
});
it("reports automatic expiry storage errors without an unhandled rejection", async () => {
    let now = 0;
    const failures: unknown[] = [];
    const control = new ReplyControl(
        {
            load: async () => [],
            save: async () => {},
            remove: async () => {
                throw new Error("disk");
            },
        },
        () => {},
        async () => {},
        () => now,
        (e) => {
            failures.push(e);
        },
    );
    await control.set(target, ["all"], 10);
    now = 10;
    control.expire();
    await control.flush();
    await Promise.resolve();
    expect(control.get(target)).toBeUndefined();
    expect(failures).toHaveLength(1);
});
it("restores permanent and unexpired rules in a fresh instance after restart", async () => {
    const { control, rows } = fixture();
    await control.set(target, ["at"], null);
    const other = { ...target, channelId: "other" };
    await control.set(other, ["all"], 60000);
    const restarted = new ReplyControl(
        { load: async () => [...rows.values()], save: async () => {}, remove: async () => {} },
        () => {},
        async () => {},
        () => 2000,
    );
    await restarted.initialize();
    expect(restarted.get(target)?.expiresAt).toBeNull();
    expect(restarted.get(other)?.expiresAt).toBe(61000);
    expect(restarted.allowed(target, ["at", "text"])).toEqual(["text"]);
});
