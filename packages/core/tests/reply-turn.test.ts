import { expect, it } from "bun:test";
import { withReplyTurn, assertReplyTurn, guardReplySession } from "../src/agent/reply-turn";
it("stops delayed sends from cancelled turns but leaves normal commands working", async () => {
    let valid = true,
        sends = 0;
    const bot = {
        sendMessage: async () => {
            sends++;
        },
    };
    const session = {
        bot,
        send: async function () {
            await this.bot.sendMessage();
        },
    };
    await withReplyTurn(
        () => valid,
        async () => {
            const guarded = guardReplySession(session as any);
            valid = false;
            expect(() => assertReplyTurn()).toThrow();
            await expect(guarded.send("old")).rejects.toThrow();
        }
    );
    await session.send();
    expect(sends).toBe(1);
});
it("blocks delivery into another paused target without affecting ordinary command sends", async () => {
    let sends = 0;
    const bot = {
        platform: "onebot",
        selfId: "b",
        sendMessage: async () => {
            sends++;
        },
    };
    await withReplyTurn(
        () => true,
        async () => {
            const session = guardReplySession({ bot } as any);
            await expect(session.bot.sendMessage("paused", "old")).rejects.toThrow();
            await session.bot.sendMessage("open", "ok");
        },
        undefined,
        (target) => target.channelId !== "paused"
    );
    expect(sends).toBe(1);
});
it("checks an adapter's real private channel again after asynchronous resolution", async () => {
    let valid = true,
        sends = 0;
    const bot = {
        platform: "discord",
        selfId: "b",
        createDirectChannel: async () => {
            valid = false;
            return { id: "real-dm" };
        },
        sendPrivateMessage: async () => {
            sends++;
        },
        sendMessage: async () => {
            sends++;
        },
    };
    await withReplyTurn(
        () => valid,
        async () => {
            const session = guardReplySession({ bot } as any);
            await expect(session.bot.sendPrivateMessage("user", "old")).rejects.toThrow();
        }
    );
    expect(sends).toBe(0);
});
it("preserves the direct category for private channel IDs without a private prefix", async () => {
    let delivered = "";
    const bot = {
        platform: "discord",
        selfId: "b",
        createDirectChannel: async () => ({ id: "real-dm" }),
        sendPrivateMessage: async () => {},
        sendMessage: async (id: string) => {
            delivered = id;
        },
    };
    await withReplyTurn(
        () => true,
        async () => {
            const session = guardReplySession({ bot } as any);
            await session.bot.sendPrivateMessage("user", "ok");
        },
        undefined,
        (target) => target.isDirect === true
    );
    expect(delivered).toBe("real-dm");
});
