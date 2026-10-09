import assert from "node:assert/strict";

import { test } from "vitest";

import { apply } from "../src/index";
import { PersonStore, registerModels, sceneKey } from "../src/store";
import { fixture } from "./helpers";
const defaults = { enabled: true, mode: "review", modelGroup: "", summaryThreshold: 6, cooldownSeconds: 600, timeoutSeconds: 30, maxQueue: 32 };
const session = (extra = {}) => ({
    platform: "onebot",
    bot: { selfId: "b" },
    channelId: "g",
    userId: "u",
    isDirect: false,
    author: { name: "群友" },
    content: "喜欢 Python",
    messageId: "m",
    timestamp: Date.now(),
    user: { authority: 3 },
    ...extra,
});
async function setup(t, config = {}, capabilities = true) {
    const tools = new Map(),
        commands = new Map(),
        hooks = new Map();
    let injection,
        middleware,
        disposed = false;
    const warnings = [];
    const ctx = await fixture(t, registerModels);
    {
        // External YIB services and Koishi command dispatch only; DB remains actual SQLite.
        const facade = { model: ctx.model, database: ctx.database };
        facade["yesimbot.tool"] = {
            registerTool: (tool) => tools.set(tool.name, tool),
            unregisterTool: (name) => tools.delete(name),
            ...(capabilities ? { capabilities: { trustedToolSession: 1 } } : {}),
        };
        facade["yesimbot.prompt"] = {
            inject: (_name, _priority, fn) => {
                injection = fn;
                return () => {
                    disposed = true;
                    injection = undefined;
                };
            },
        };
        facade["yesimbot.world-state"] = {
            isChannelAllowed: (s) => s.channelId !== "blocked",
            ...(capabilities ? { capabilities: { beforeUserStimulus: 1 } } : {}),
        };
        facade.command = (name, description, options) => {
            const spec = { name, description, options, action: null, optionDeclarations: [] };
            commands.set(name.split(" ")[0], spec);
            const chain = {
                option: (...option) => {
                    spec.optionDeclarations.push(option);
                    return chain;
                },
                action: (fn) => {
                    spec.action = fn;
                    return chain;
                },
            };
            return chain;
        };
        facade.on = (name, fn) => {
            hooks.set(name, fn);
        };
        facade.middleware = (fn) => {
            middleware = fn;
        };
        facade.logger = () => ({
            warn(message) {
                warnings.push(message);
            },
            error() {},
            info() {},
        });
        apply(facade, { ...defaults, ...config });
    }
    async function command(name, s, ...args) {
        return commands.get(name).action({ session: s, options: {} }, ...args);
    }
    async function commandWithOptions(name, s, options, ...args) {
        return commands.get(name).action({ session: s, options }, ...args);
    }
    async function capture(s) {
        const hook = hooks.get("yesimbot/before-user-stimulus");
        assert.equal(typeof hook, "function", "awaited before-user-stimulus listener must be registered");
        await hook(s);
    }
    return {
        ctx,
        tools,
        commands,
        hooks,
        command,
        commandWithOptions,
        capture,
        warnings,
        get injection() {
            return injection;
        },
        get middleware() {
            return middleware;
        },
        get disposed() {
            return disposed;
        },
    };
}
test("disabled plugin has no registrations; all lifecycle commands require authority 3", async (t) => {
    const off = await setup(t, { enabled: false });
    assert.equal(off.tools.size, 0);
    assert.equal(off.commands.size, 0);
    const f = await setup(t);
    for (const cmd of f.commands.values()) assert.equal(cmd.options.authority, 3);
    for (const name of [
        "people.status",
        "people.show",
        "people.sources",
        "people.create",
        "people.bind",
        "people.unbind",
        "people.merge",
        "people.split",
        "people.edit",
        "people.lock",
        "people.unlock",
        "people.pending",
        "people.approve",
        "people.reject",
        "people.history",
        "people.archive",
        "people.revert",
        "people.pause",
        "people.resume",
        "people.mode",
        "people.summarize",
    ])
        assert.ok(f.commands.has(name), name);
    const denied = await f.command("people.create", session({ user: { authority: 1 } }), "不可创建");
    assert.match(denied, /管理员/);
});
test("capture skips bots, blocked scenes and commands; current account is injected without changing sender", async (t) => {
    const f = await setup(t),
        s = session();
    await f.capture(s);
    const ctx = await f.injection({ session: s });
    assert.match(ctx, /群友/);
    assert.equal(s.userId, "u");
    assert.equal(s.author.name, "群友");
    const tool = f.tools.get("person_memory");
    const own = await tool.execute({ session: s, action: "read", account_id: "u" });
    assert.equal(own.status, "success");
    assert.equal((await tool.execute({ session: session({ channelId: "other" }), action: "read", account_id: "u" })).status, "error");
    for (const input of [
        session({ channelId: "blocked" }),
        session({ userId: "bot-user", author: { isBot: true } }),
        session({ userId: "cmd-user", __commandHandled: true }),
    ])
        await f.capture(input);
    assert.equal((await tool.execute({ session: s, action: "read", account_id: "bot-user" })).status, "error");
    assert.equal((await tool.execute({ session: s, action: "read", account_id: "cmd-user" })).status, "error");
});
test("model can only propose; admin reviews/locks; scoped tools cannot rebind or approve", async (t) => {
    const f = await setup(t),
        s = session();
    await f.capture(s);
    const tool = f.tools.get("person_memory");
    const initial = await tool.execute({ session: s, action: "read", account_id: "u" });
    const versions = { person_id: initial.result.id, person_revision: initial.result.revision, account_revision: initial.result.accounts[0].revision };
    const proposal = await tool.execute({ session: s, action: "propose", account_id: "u", profile: "喜欢 Python", message_ids: ["m"], ...versions });
    assert.equal(proposal.status, "success");
    let read = await tool.execute({ session: s, action: "read", account_id: "u" });
    assert.equal(read.result.profile, "");
    assert.equal((await tool.execute({ session: s, action: "bind", account_id: "u" })).status, "error");
    assert.equal((await tool.execute({ session: s, action: "approve", proposal_id: proposal.result.id })).status, "error");
    assert.match(await f.command("people.approve", s, proposal.result.id), /已接受/);
    assert.match(await f.command("people.lock", s, "u"), /锁定/);
    assert.equal((await tool.execute({ session: s, action: "propose", account_id: "u", profile: "替换", ["message_ids"]: ["m"] })).status, "error");
    assert.equal((await tool.execute({ session: session({ channelId: "blocked" }), action: "read", account_id: "u" })).status, "error");
});
test("a main model proposal based on stale context cannot overwrite a manual edit in auto mode", async (t) => {
    const f = await setup(t, { mode: "auto" }),
        s = session();
    await f.capture(s);
    const tool = f.tools.get("person_memory");
    const initial = (await tool.execute({ session: s, action: "read", account_id: "u" })).result;
    await f.command("people.edit", s, "u", "人工新画像");
    const proposal = await tool.execute({
        session: s,
        action: "propose",
        account_id: "u",
        profile: "旧模型画像",
        message_ids: ["m"],
        person_id: initial.id,
        person_revision: initial.revision,
        account_revision: initial.accounts[0].revision,
    });
    assert.equal(proposal.status, "error");
    assert.equal((await tool.execute({ session: s, action: "read", account_id: "u" })).result.profile, "人工新画像");
});
test("create, bind, split, mode and pause work; unload removes tools and injection", async (t) => {
    const f = await setup(t),
        s = session();
    await f.capture(s);
    const created = await f.command("people.create", s, "许仙");
    const id = created.match(/[0-9a-f-]{36}/)[0];
    assert.match(await f.command("people.bind", s, "u", id, 0.9), /已关联/);
    assert.match(await f.command("people.show", s, "u"), /许仙/);
    assert.match(await f.command("people.split", s, "u", "另一个人"), /已拆分/);
    assert.match(await f.command("people.mode", s, "auto"), /auto/);
    assert.match(await f.command("people.pause", s), /暂停/);
    assert.equal(
        (await f.tools.get("person_memory").execute({ session: s, action: "propose", account_id: "u", profile: "新", ["message_ids"]: ["m"] })).status,
        "error",
    );
    await f.hooks.get("dispose")();
    assert.equal(f.tools.size, 0);
    assert.equal(f.disposed, true);
});

test("awaited capture makes the first message available before prompt and tools; dispose prevents writes", async (t) => {
    const f = await setup(t),
        s = session();
    await f.capture(s);
    const tool = f.tools.get("person_memory"),
        read = (await tool.execute({ session: s, action: "read", account_id: "u" })).result;
    assert.match(await f.injection({ session: s }), new RegExp(read.id));
    const result = await tool.execute({
        session: s,
        action: "propose",
        account_id: "u",
        profile: "首次消息已记录",
        message_ids: ["m"],
        person_id: read.id,
        person_revision: read.revision,
        account_revision: read.accounts[0].revision,
    });
    assert.equal(result.status, "success");
    await f.hooks.get("dispose")();
    await f.capture(session({ userId: "late", messageId: "late" }));
    const store = new PersonStore(f.ctx.database, "review");
    assert.equal(await store.find(sceneKey(s), "late"), undefined);
});
test("capture failure is logged without aborting user stimulus delivery", async (t) => {
    const f = await setup(t);
    await f.capture(session({ userId: "x".repeat(257) }));
    assert.equal(f.warnings.length, 1);
    assert.match(f.warnings[0], /记录失败/);
});
test("identity-change warning remains after a fresh manual profile in read, show and prompt", async (t) => {
    const f = await setup(t),
        s = session();
    await f.capture(s);
    const created = await f.command("people.create", s, "另一个人"),
        id = created.match(/[0-9a-f-]{36}/)[0];
    await f.command("people.bind", s, "u", id, 0.9);
    await f.command("people.edit", s, "u", "人工已复核的新画像");
    const read = (await f.tools.get("person_memory").execute({ session: s, action: "read", account_id: "u" })).result;
    assert.equal(read.stale, false);
    assert.equal(read.identityChanged, true);
    assert.ok(read.identityChangedAt > 0);
    assert.match(await f.command("people.show", s, "u"), /身份关联曾改变/);
    const prompt = await f.injection({ session: s });
    assert.match(prompt, /identity_changed="true"/);
    assert.match(prompt, /身份关联曾改变/);
    assert.match(prompt, /L2.*L3/);
    assert.match(prompt, /history/);
    assert.match(prompt, /人工已复核的新画像/);
});
test("link candidates stay pending in auto mode, include types and require current scoped evidence and versions", async (t) => {
    const f = await setup(t, { mode: "auto" }),
        s = session();
    await f.capture(s);
    await f.capture(session({ userId: "target", messageId: "target-m", author: { name: "目标" } }));
    const tool = f.tools.get("person_memory"),
        source = (await tool.execute({ session: s, action: "read", account_id: "u" })).result,
        target = (await tool.execute({ session: s, action: "read", account_id: "target" })).result;
    const input = {
        session: s,
        action: "propose_link",
        account_id: "u",
        person_id: source.id,
        person_revision: source.revision,
        account_revision: source.accounts[0].revision,
        target_person_id: target.id,
        target_revision: target.revision,
        confidence: 0.8,
        reason: "账号在消息中表明同一人物",
        message_ids: ["m"],
    };
    for (const patch of [
        { target_revision: undefined },
        { confidence: NaN },
        { reason: "" },
        { message_ids: ["target-m"] },
        { target_person_id: "outside-scene" },
        { person_revision: source.revision + 1 },
    ])
        assert.equal((await tool.execute({ ...input, ...patch })).status, "error");
    const proposed = await tool.execute(input);
    assert.equal(proposed.status, "success");
    assert.equal(proposed.result.state, "pending");
    assert.equal(proposed.result.type, "link");
    const read = (await tool.execute({ session: s, action: "read", account_id: "u" })).result;
    assert.equal(read.id, source.id);
    assert.match(await f.command("people.pending", s), /账号关联/);
    assert.match(await f.command("people.pending", s, proposed.result.id), /目标人物/);
    const status = JSON.parse(await f.command("people.status", s));
    assert.equal(status.pending, 1);
    assert.equal(status.profilePending, 0);
    assert.equal(status.linkPending, 1);
    assert.match(await f.injection({ session: s }), new RegExp(proposed.result.id));
    assert.match(await f.injection({ session: session({ userId: "target" }) }), new RegExp(proposed.result.id));
    assert.equal((await tool.execute({ session: s, action: "approve", id: proposed.result.id })).status, "error");
    assert.equal((await tool.execute({ ...input, session: session({ channelId: "other" }) })).status, "error");
    assert.match(await f.command("people.approve", s, proposed.result.id), /已接受/);
    assert.equal((await tool.execute({ session: s, action: "read", account_id: "u" })).result.id, target.id);
});
test("history command pages and filters the full history; history tool stays account scoped", async (t) => {
    const f = await setup(t),
        s = session();
    await f.capture(s);
    await f.capture(session({ userId: "other", messageId: "other" }));
    for (let i = 0; i < 13; i++) await f.command("people.edit", s, "u", `画像 ${i}`);
    await f.command("people.edit", s, "other", "不相关人物的秘密");
    const first = await f.commandWithOptions("people.history", s, { page: 1, account: "u", action: "profile" }),
        second = await f.commandWithOptions("people.history", s, { page: 2, account: "u", action: "profile" });
    assert.equal((first.match(/#\d+ profile/g) || []).length, 10);
    assert.equal((second.match(/#\d+ profile/g) || []).length, 3);
    assert.equal(
        [...first.matchAll(/[0-9a-f-]{36}/g)].some((x) => second.includes(x[0])),
        false,
    );
    const read = (await f.tools.get("person_memory").execute({ session: s, action: "read", account_id: "u" })).result;
    const personal = await f.commandWithOptions("people.history", s, { page: 2, person: read.id, action: "profile" });
    assert.equal((personal.match(/#\d+ profile/g) || []).length, 3);
    const history = await f.tools.get("person_memory").execute({ session: s, action: "history", account_id: "u" });
    assert.equal(history.status, "success");
    assert.equal(history.result.length, 10);
    assert.equal(JSON.stringify(history.result).includes("不相关人物的秘密"), false);
    assert.equal(
        (await f.tools.get("person_memory").execute({ session: session({ channelId: "other" }), action: "history", account_id: "u" })).status,
        "error",
    );
    assert.match(await f.commandWithOptions("people.history", s, { page: 0 }), /页码/);
    assert.match(await f.commandWithOptions("people.history", s, { account: "u", person: read.id }), /不能同时/);
});
test("archive previews associated accounts and refuses stale revision before removing an audited person", async (t) => {
    const f = await setup(t),
        s = session();
    await f.capture(s);
    const tool = f.tools.get("person_memory"),
        read = (await tool.execute({ session: s, action: "read", account_id: "u" })).result;
    const preview = await f.command("people.archive", s, "u");
    assert.match(preview, new RegExp(read.id));
    assert.match(preview, /版本/);
    assert.match(preview, /u/);
    assert.equal((await tool.execute({ session: s, action: "read", account_id: "u" })).status, "success");
    await f.command("people.edit", s, "u", "版本变化");
    assert.match(await f.command("people.archive", s, "u", read.revision), /版本|过期/);
    assert.equal((await tool.execute({ session: s, action: "read", account_id: "u" })).status, "success");
    const current = (await tool.execute({ session: s, action: "read", account_id: "u" })).result;
    const archived = await f.command("people.archive", s, "u", current.revision);
    assert.match(archived, /已归档/);
    assert.ok(archived.includes(current.id));
    assert.equal(archived.includes("undefined"), false);
    assert.equal((await tool.execute({ session: s, action: "read", account_id: "u" })).status, "error");
    assert.match(await f.command("people.history", s), /archive/);
    assert.match(await f.command("people.sources", s, "u"), /喜欢 Python/);
});

test("model history retains bounded metadata and change summaries for large profiles", async (t) => {
    const f = await setup(t),
        s = session();
    await f.capture(s);
    for (let i = 0; i < 12; i++) await f.command("people.edit", s, "u", `画像${i}:` + "长".repeat(1800));
    const result = await f.tools.get("person_memory").execute({ session: s, action: "history", account_id: "u" });
    assert.equal(result.status, "success");
    assert.equal(result.result.length, 10);
    assert.ok(JSON.stringify(result.result).length <= 12000);
    assert.ok(result.result.every((row) => row.action === "profile" && row.revision > 0 && typeof row.timestamp === "number"));
    assert.ok(result.result.some((row) => row.changes.length > 0));
    assert.ok(result.result.every((row) => typeof row.changeCount === "number"));
});

test("model history includes profile changes for the formerly associated person after a split", async (t) => {
    const f = await setup(t),
        s = session();
    await f.capture(s);
    await f.command("people.edit", s, "u", "旧人物喜欢 Go");
    await f.command("people.split", s, "u", "重新认识的人物");
    const result = await f.tools.get("person_memory").execute({ session: s, action: "history", account_id: "u" });
    assert.equal(result.status, "success");
    const profile = result.result.find((row) => row.action === "profile");
    assert.ok(profile);
    assert.ok(profile.changeCount > 0);
    assert.match(JSON.stringify(profile.changes), /旧人物喜欢 Go/);
});

test("legacy core without required capabilities fails before registering business effects", () => {
    for (const missing of ["both", "world", "tool"]) {
        const effects = [];
        const ctx = {
            "yesimbot.world-state": { isChannelAllowed: () => true, ...(missing === "tool" ? { capabilities: { beforeUserStimulus: 1 } } : {}) },
            "yesimbot.tool": { registerTool: () => effects.push("tool"), ...(missing === "world" ? { capabilities: { trustedToolSession: 1 } } : {}) },
            "yesimbot.prompt": { inject: () => effects.push("prompt") },
            model: { extend: () => effects.push("model") },
            on: () => effects.push("listener"),
            command: () => effects.push("command"),
        };
        assert.throws(() => apply(ctx, defaults), /3\.0\.4.*beforeUserStimulus.*trustedToolSession/);
        assert.deepEqual(effects, []);
    }
});
