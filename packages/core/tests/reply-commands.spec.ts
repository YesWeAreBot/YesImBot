import { describe, expect, it } from "vitest";

import { registerReplyCommands } from "../src/agent/reply-commands";
import { ReplyControl, ReplyRule, replyKey } from "../src/agent/reply-control";

function fixture() {
    const actions = new Map<string, (...args: any[]) => any>();
    const authorities = new Map<string, number>();
    const rows = new Map<string, ReplyRule>();
    const changes: string[] = [];
    const command = (declaration: string, config: any, parent = "") => {
        const name = declaration.split(" ")[0];
        const fullName = name.startsWith(".") ? `${parent}${name}` : name;
        authorities.set(fullName, config?.authority);
        const instance: any = {
            option: () => instance,
            usage: () => instance,
            example: () => instance,
            action: (action: (...args: any[]) => any) => {
                actions.set(fullName, action);
                return instance;
            },
            subcommand: (declaration: string, _description: string, config: any) => command(declaration, config, fullName),
        };
        return instance;
    };
    const ctx = {
        bots: [
            { platform: "onebot", selfId: "bot", createDirectChannel: async (userId: string) => ({ id: `private:${userId}` }) },
            { platform: "discord", selfId: "discord-bot", createDirectChannel: async (userId: string) => ({ id: `dm-${userId}` }) },
        ],
        command: (declaration: string, _description: string, config: any) => command(declaration, config),
    };
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
        (_target, reason) => {
            changes.push(reason);
        },
        async () => {},
        () => 1000000,
    );
    const session: any = {
        platform: "onebot",
        selfId: "bot",
        channelId: "group",
        bot: ctx.bots[0],
    };
    registerReplyCommands(ctx as any, control, 60000);
    const invoke = async (name: string, options: any = {}, duration?: string, from = session) => actions.get(name)!({ session: from, options }, duration);
    const target = { platform: "onebot", selfId: "bot", channelId: "group" };
    return { ctx, control, rows, changes, authorities, session, target, invoke };
}

describe("reply control commands", () => {
    it("registers all management commands at authority 3", () => {
        const { authorities } = fixture();
        expect([...authorities.entries()]).toEqual([
            ["chat", 3],
            ["chat.pause", 3],
            ["chat.resume", 3],
            ["chat.status", 3],
        ]);
    });

    it("uses the invoking target and the configured 60-second default", async () => {
        const { invoke, control, target } = fixture();
        expect(await invoke("chat.pause")).toContain("已更新 onebot:bot:group");
        expect(control.get(target)?.expiresAt).toBe(1060000);
        expect(control.get(target)?.blocked).toEqual(["text", "at", "quote", "direct", "system", "scheduled", "background"]);
    });

    it("preserves the current private channel and prefixes a specified private user", async () => {
        const { invoke, session, rows } = fixture();
        await invoke("chat.pause", {}, undefined, { ...session, channelId: "private:alice" });
        await invoke("chat.pause", { user: "bob" });
        await invoke("chat.pause", { user: "private:carol" });
        expect([...rows.values()].map((rule) => rule.channelId)).toEqual(["private:alice", "private:bob", "private:carol"]);
    });

    it("requires an explicit cross-platform target and infers a unique robot", async () => {
        const { invoke, rows, control } = fixture();
        for (const options of [{ platform: "discord" }, { platform: "discord", bot: "discord-bot" }]) {
            expect(await invoke("chat.pause", options)).toContain("跨平台操作必须");
        }
        expect(rows.size).toBe(0);
        await invoke("chat.pause", { platform: "discord", bot: "discord-bot", user: "alice" });
        expect(control.get({ platform: "discord", selfId: "discord-bot", channelId: "dm-alice" })).toBeDefined();
    });

    it("rejects unknown robots and conflicts but keeps the receiving bot on the current platform", async () => {
        const { invoke, ctx, rows } = fixture();
        expect(await invoke("chat.pause", { bot: "missing" })).toContain("未找到");
        expect(await invoke("chat.pause", { group: "g", user: "u" })).toContain("不能同时使用");
        ctx.bots.push({ platform: "onebot", selfId: "other-bot" });
        expect(await invoke("chat.pause", { platform: "onebot", group: "g" })).toContain("已更新 onebot:bot:g");
        expect(rows.size).toBe(1);
    });

    it("allow at suppresses all other categories without suppressing at", async () => {
        const { invoke, control, target } = fixture();
        await invoke("chat.pause", { allow: "at" }, "5m");
        expect(control.get(target)?.blocked).toEqual(["text", "quote", "direct", "system", "scheduled", "background"]);
        expect(control.allowed(target, ["text", "at", "quote"])).toEqual(["at"]);
        expect(control.get(target)?.expiresAt).toBe(1300000);
    });

    it("replaces a temporary rule with a permanent rule and resumes independently", async () => {
        const { invoke, control, target, rows, changes } = fixture();
        await invoke("chat.pause");
        await invoke("chat.pause", { block: "text,system" }, "permanent");
        expect(rows.size).toBe(1);
        expect(rows.get(replyKey(target))?.expiresAt).toBeNull();
        expect(control.get(target)?.blocked).toEqual(["text", "system"]);
        expect(changes).toEqual(["pause", "replace"]);
        expect(await invoke("chat.status")).toContain("永久生效");
        expect(await invoke("chat.resume")).toContain("已解除");
        expect(await invoke("chat.status")).toContain("没有生效");
        expect(rows.size).toBe(0);
    });

    it("rejects invalid durations before changing state", async () => {
        const { invoke, rows, changes } = fixture();
        for (const duration of ["0", "-1", "1week", "NaN", "Infinity", "999999999999999999999d", "0.0001ms"]) {
            expect(await invoke("chat.pause", {}, duration)).toContain("操作失败");
        }
        expect(rows.size).toBe(0);
        expect(changes).toEqual([]);
    });

    it("rejects invalid categories, all mixtures, and simultaneous block/allow", async () => {
        const { invoke, rows, changes } = fixture();
        for (const options of [
            { block: "unknown" },
            { block: "" },
            { allow: "unknown" },
            { block: "all,at" },
            { allow: "all,at" },
            { block: "text", allow: "at" },
        ]) {
            expect(await invoke("chat.pause", options)).toContain("操作失败");
        }
        expect(rows.size).toBe(0);
        expect(changes).toEqual([]);
    });
});
it("uses the adapter's real direct-channel ID for remote private targets", async () => {
    const { ctx, invoke, control } = fixture();
    Object.assign(ctx.bots[1], { createDirectChannel: async (userId: string) => ({ id: `dm-${userId}` }) });
    await invoke("chat.pause", { platform: "discord", bot: "discord-bot", user: "alice" });
    expect(control.get({ platform: "discord", selfId: "discord-bot", channelId: "dm-alice" })?.expiresAt).toBe(1060000);
});
it("supports history-style channel and target shortcuts without an unnecessary bot parameter", async () => {
    const { invoke, control } = fixture();
    await invoke("chat.pause", { channel: "another" });
    expect(control.get({ platform: "onebot", selfId: "bot", channelId: "another" })).toBeDefined();
    await invoke("chat.pause", { target: "discord:dm-alice" });
    expect(control.get({ platform: "discord", selfId: "discord-bot", channelId: "dm-alice" })).toBeDefined();
    expect(await invoke("chat.resume", { channel: "dm-alice" })).toContain("已解除 discord:discord-bot:dm-alice");
});
it("requires disambiguation only when a target has multiple matching bot rules", async () => {
    const { ctx, invoke, control } = fixture();
    ctx.bots.push({ platform: "discord", selfId: "second" } as any);
    expect(await invoke("chat.pause", { target: "discord:shared" })).toContain("多个机器人");
    await control.set({ platform: "discord", selfId: "discord-bot", channelId: "shared" }, ["all"], null);
    expect(await invoke("chat.resume", { target: "discord:shared" })).toContain("已解除");
    await control.set({ platform: "discord", selfId: "discord-bot", channelId: "shared" }, ["all"], null);
    await control.set({ platform: "discord", selfId: "second", channelId: "shared" }, ["all"], null);
    expect(await invoke("chat.resume", { target: "discord:shared" })).toContain("多个机器人");
    expect(control.get({ platform: "discord", selfId: "second", channelId: "shared" })).toBeDefined();
});
it("preserves colons in raw private channel IDs and rejects conflicting shortcuts", async () => {
    const { invoke, control } = fixture();
    await invoke("chat.pause", { target: "onebot:private:alice" });
    expect(control.get({ platform: "onebot", selfId: "bot", channelId: "private:alice" })).toBeDefined();
    for (const options of [{ target: "broken" }, { target: "onebot:" }, { channel: "a", group: "b" }, { target: "onebot:a", platform: "discord" }]) {
        expect(await invoke("chat.pause", options)).toContain("操作失败");
    }
});
it("retains normal text and quote gain categories together", async () => {
    const { invoke, control, target } = fixture();
    await invoke("chat.pause", { allow: "text,quote" }, "5m");
    expect(control.get(target)?.blocked).toEqual(["at", "direct", "system", "scheduled", "background"]);
    expect(control.allowed(target, ["text", "at", "quote", "direct"])).toEqual(["text", "quote"]);
});
it("requires an explicit platform for a raw channel ID shared by different platforms", async () => {
    const { invoke, control } = fixture();
    await control.set({ platform: "onebot", selfId: "bot", channelId: "same" }, ["all"], null);
    await control.set({ platform: "discord", selfId: "discord-bot", channelId: "same" }, ["all"], null);
    expect(await invoke("chat.resume", { channel: "same" })).toContain("多个平台");
    expect(control.get({ platform: "onebot", selfId: "bot", channelId: "same" })).toBeDefined();
    expect(await invoke("chat.resume", { target: "discord:same" })).toContain("已解除 discord:discord-bot:same");
});
