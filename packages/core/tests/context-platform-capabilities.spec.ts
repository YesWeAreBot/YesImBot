import { expect, it, vi } from "vitest";

import { ContextBuilder } from "../src/world/context-builder";

function fixture(isDirect = false) {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const bot: any = {
        user: { id: "bot", name: "Cached Bot" },
        getUser: vi.fn(async (id: string) => ({ id, name: id === "bot" ? "Remote Bot" : "Remote Alice" })),
        getChannel: vi.fn(async () => ({ id: "channel", name: "Remote Group" })),
    };
    const session: any = {
        platform: "qq",
        selfId: "bot",
        userId: "alice",
        channelId: "channel",
        guildId: "guild",
        isDirect,
        author: { id: "alice", name: "Alice" },
        bot,
    };
    const builder = new ContextBuilder(
        {} as any,
        { l1_memory: { maxMessages: 100, keepFullTurnCount: 5 }, l2_memory: { enabled: false }, l3_memory: { enabled: false } } as any,
        { getL1History: async () => [] } as any,
        {} as any,
        {} as any,
        { getLogger: () => logger } as any,
    );
    return { builder, session, bot, logger };
}

it("skips unavailable guild-member lookup without logging and preserves self identity", async () => {
    const f = fixture();
    const state = await f.builder.build(f.session);
    expect(state.self).toEqual({ id: "bot", name: "Remote Bot" });
    expect(state.users).toEqual([{ id: "bot", name: "Remote Bot", roles: ["self"] }]);
    expect(f.logger.error).not.toHaveBeenCalled();
});

it("retains guild-member lookup failures as diagnostics while keeping self identity", async () => {
    const f = fixture();
    f.bot.getGuildMember = vi.fn(async () => {
        throw new Error("guild lookup failed");
    });
    const state = await f.builder.build(f.session);
    expect(f.bot.getGuildMember).toHaveBeenCalledWith("guild", "bot");
    expect(f.logger.error).toHaveBeenCalledWith("获取机器人自身信息失败 for id bot: guild lookup failed");
    expect(state.users).toEqual([{ id: "bot", name: "Remote Bot", roles: ["self"] }]);
});

it("preserves guild nickname and both string and object role identities", async () => {
    const f = fixture();
    f.bot.getGuildMember = vi.fn(async () => ({ nick: "Guild Bot", name: "Member Bot", roles: ["admin", { id: "moderator" }] }));
    const state = await f.builder.build(f.session);
    expect(f.bot.getGuildMember).toHaveBeenCalledWith("guild", "bot");
    expect(state.users).toEqual([{ id: "bot", name: "Guild Bot", roles: ["self", "admin", "moderator"] }]);
    expect(f.logger.error).not.toHaveBeenCalled();
});

it("does not request a guild member without a guild ID", async () => {
    const f = fixture();
    delete f.session.guildId;
    f.bot.getGuildMember = vi.fn();
    await f.builder.build(f.session);
    expect(f.bot.getGuildMember).not.toHaveBeenCalled();
});

it("falls back to cached bot identity and unknown group when optional lookup methods are absent", async () => {
    const f = fixture();
    delete f.bot.getUser;
    delete f.bot.getChannel;
    const state = await f.builder.build(f.session);
    expect(state.self).toEqual({ id: "bot", name: "Cached Bot" });
    expect(state.channel.name).toBe("未知群组");
    expect(state.users).toEqual([{ id: "bot", name: "Cached Bot", roles: ["self"] }]);
    expect(f.logger.debug).not.toHaveBeenCalled();
    expect(f.logger.error).not.toHaveBeenCalled();
});

it("builds direct context without optional user lookup using the event author", async () => {
    const f = fixture(true);
    delete f.bot.getUser;
    f.bot.getGuildMember = vi.fn();
    const state = await f.builder.build(f.session);
    expect(state.channel.name).toBe("与 Alice 的私聊");
    expect(state.users).toEqual([
        { id: "alice", name: "Alice" },
        { id: "bot", name: "Cached Bot", roles: ["self"] },
    ]);
    expect(f.bot.getGuildMember).not.toHaveBeenCalled();
    expect(f.logger.debug).not.toHaveBeenCalled();
});

it("retains diagnostics for supported user and channel lookups that fail", async () => {
    const f = fixture();
    f.bot.getGuildMember = vi.fn(async () => ({}));
    f.bot.getUser = vi.fn(async () => {
        throw new Error("user lookup failed");
    });
    f.bot.getChannel = vi.fn(async () => {
        throw new Error("channel lookup failed");
    });
    const state = await f.builder.build(f.session);
    expect(state.self).toEqual({ id: "bot", name: "Cached Bot" });
    expect(state.channel.name).toBe("未知群组");
    expect(f.logger.debug).toHaveBeenCalledWith("获取机器人自身信息失败 for id bot: user lookup failed");
    expect(f.logger.debug).toHaveBeenCalledWith("获取频道信息失败 for channel channel: channel lookup failed");
});

it("retains direct user lookup diagnostics and falls back to the event author", async () => {
    const f = fixture(true);
    f.bot.getUser = vi.fn(async () => {
        throw new Error("user lookup failed");
    });
    const state = await f.builder.build(f.session);
    expect(state.channel.name).toBe("与 Alice 的私聊");
    expect(state.self).toEqual({ id: "bot", name: "Cached Bot" });
    expect(f.logger.debug).toHaveBeenCalledWith("获取用户信息失败 for user alice: user lookup failed");
    expect(f.logger.debug).toHaveBeenCalledWith("获取机器人自身信息失败 for id bot: user lookup failed");
});

it("keeps ID and default name fallbacks when event and cached names are unavailable", async () => {
    const f = fixture(true);
    delete f.bot.getUser;
    delete f.bot.user;
    delete f.session.author;
    const state = await f.builder.build(f.session);
    expect(state.channel.name).toBe("与 alice 的私聊");
    expect(state.self).toEqual({ id: "bot", name: "Self" });
    expect(state.users?.find((user) => user.id === "bot")).toEqual({ id: "bot", name: "Self", roles: ["self"] });
    expect(f.logger.debug).not.toHaveBeenCalled();
});
