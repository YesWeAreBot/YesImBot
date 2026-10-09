import assert from "node:assert/strict";

import { h } from "koishi";
import { OneBotMessageEncoder } from "koishi-plugin-adapter-onebot";
import { test } from "vitest";

import * as plugin from "../src/index";
import { database } from "./helpers";

async function setup(t, config = {}) {
    const real = await database(t);
    let tool;
    const commands = {};
    const activity = { models: 0, commands: 0 };
    const ctx = {
        model: {
            extend() {
                activity.models++;
            },
        },
        logger: { warn() {} },
        on() {},
        "yesimbot.tool": {
            registerTool(item) {
                tool = item;
            },
            unregisterTool() {},
        },
        command(name) {
            activity.commands++;
            return {
                option() {
                    return this;
                },
                action(callback) {
                    commands[name] = callback;
                    return this;
                },
            };
        },
        database: real.database,
    };
    plugin.apply(ctx, { enabled: true, concurrency: 2, batchSize: 100, ...config });
    const session = {
        platform: "onebot",
        channelId: "g",
        guildId: "g",
        isDirect: false,
        bot: {
            platform: "onebot",
            selfId: "bot1",
            internal: {
                async getFriendList() {
                    return [];
                },
                async getGroupMemberList() {
                    return Array.from({ length: 2005 }, (_, i) => ({ user_id: i + 1, nickname: `User ${i + 1}` }));
                },
            },
        },
    };
    return { tool, session, activity, commands };
}

test("model gets only count, exact lookup or bounded page; all/refresh are ignored", async (t) => {
    const { tool, session } = await setup(t);
    assert.equal("all" in tool.parameters.dict, false);
    assert.equal("refresh" in tool.parameters.dict, false);
    const count = await tool.execute({ session, kind: "members", mode: "count" });
    assert.equal(count.result.total, 2005);
    assert.equal(count.result.entries.length, 0);
    const page = await tool.execute({ session, kind: "members", mode: "page", limit: 20, all: true, refresh: true });
    assert.equal(page.result.entries.length, 20);
    const lookup = await tool.execute({ session, kind: "members", mode: "lookup", user_id: "2005" });
    assert.deepEqual(
        lookup.result.entries.map((x) => x.userId),
        ["2005"],
    );
    const tooLarge = await tool.execute({ session, kind: "members", mode: "page", limit: 2005 });
    assert.equal(tooLarge.status, "error");
});

test("repeated model pages stop after a bounded number of entries", async (t) => {
    const { tool, session } = await setup(t);
    for (let offset = 0; offset < 80; offset += 20) {
        const response = await tool.execute({ session, kind: "members", mode: "page", offset, limit: 20 });
        assert.equal(response.result.entries.length, 20);
    }
    const blocked = await tool.execute({ session, kind: "members", mode: "page", offset: 80, limit: 20 });
    assert.equal(blocked.status, "error");
});

test("concurrent model pages reserve the same shared budget", async (t) => {
    const { tool, session } = await setup(t);
    const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => tool.execute({ session, kind: "members", mode: "page", offset: i * 20, limit: 20 })),
    );
    assert.equal(
        results.filter((x) => x.status === "success").reduce((n, x) => n + x.result.entries.length, 0),
        80,
    );
    assert.equal(results.filter((x) => x.status === "error").length, 6);
});

test("model cannot cross group boundaries or read friends from a public group", async (t) => {
    const { tool, session } = await setup(t);
    const crossGroup = await tool.execute({ session, kind: "members", mode: "count", group_id: "other" });
    const friends = await tool.execute({ session, kind: "friends", mode: "count" });
    assert.equal(crossGroup.status, "error");
    assert.equal(friends.status, "error");
});

test("private administrator can query, while an unverified private user is denied", async (t) => {
    const { tool, session } = await setup(t);
    session.isDirect = true;
    session.guildId = undefined;
    session.channelId = "private";
    session.observeUser = async () => ({ authority: 1 });
    const denied = await tool.execute({ session, kind: "members", mode: "count", group_id: "g" });
    assert.equal(denied.status, "error");
    session.observeUser = async () => ({ authority: 3 });
    const allowed = await tool.execute({ session, kind: "members", mode: "count", group_id: "g" });
    assert.equal(allowed.status, "success");
    const friends = await tool.execute({ session, kind: "friends", mode: "count" });
    assert.equal(friends.status, "success");
});

test("disabled plugin registers no tables, tool or commands", async (t) => {
    const { tool, activity } = await setup(t, { enabled: false });
    assert.equal(tool, undefined);
    assert.equal(activity.models, 0);
    assert.equal(activity.commands, 0);
});

test("admin command sends all user-controlled fields as OneBot text instead of elements", async (t) => {
    const { session, commands } = await setup(t);
    const payload = '<at type="all"/>';
    session.guildId = payload;
    session.bot.selfId = payload;
    session.bot.internal.getGroupMemberList = async () => [
        { user_id: payload, card: payload, role: payload },
        { user_id: 2, remark: payload },
        { user_id: 3, nickname: payload },
    ];
    const encoded = [];
    session.send = async (content) => {
        const encoder = Object.create(OneBotMessageEncoder.prototype);
        encoder.children = [];
        encoder.stack = [{ type: "message", author: {}, children: [] }];
        for (const element of h.normalize(content)) await encoder.visit(element);
        encoded.push(...encoder.children);
    };
    await commands["onebot.contacts.members"]({ session, options: {} });
    assert.equal(encoded.length > 0, true);
    assert.equal(
        encoded.every((x) => x.type === "text"),
        true,
        JSON.stringify(encoded),
    );
    assert.equal(
        encoded
            .map((x) => x.data.text)
            .join("")
            .includes(payload),
        true,
    );
});

test("empty directory headers and adapter errors return escaped Koishi text", async (t) => {
    const { h } = require("koishi");
    const { session, commands } = await setup(t);
    const payload = '<at type="all"/>';
    session.guildId = payload;
    session.bot.selfId = payload;
    session.bot.internal.getGroupMemberList = async () => [];
    const header = await commands["onebot.contacts.members"]({ session, options: {} });
    const normalized = h.normalize(header);
    assert.equal(
        normalized.every((x) => x.type === "text"),
        true,
    );
    assert.equal(
        normalized
            .map((x) => x.attrs.content)
            .join("")
            .includes(payload),
        true,
    );
    session.bot.internal.getGroupMemberList = async () => {
        throw new Error(payload);
    };
    const error = await commands["onebot.contacts.members"]({ session, options: { refresh: true } });
    assert.equal(
        h.normalize(error).every((x) => x.type === "text"),
        true,
    );
    assert.equal(
        h
            .normalize(error)
            .map((x) => x.attrs.content)
            .join("")
            .includes(payload),
        true,
    );
});
