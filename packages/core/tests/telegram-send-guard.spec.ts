import { Bot, Context, MessageEncoder } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import { guardReplyBot, withReplyTurn } from "../src/agent/reply-turn";

async function fixture() {
    const ctx = new Context();
    let blocked = false;
    let sent = 0;
    class Encoder extends MessageEncoder {
        async visit() {}
        async flush() {
            await Promise.resolve();
            blocked = true;
            await this.bot.internal.sendMessage();
            this.results.push({ id: "sent" });
        }
    }
    class TelegramBot extends Bot {
        static MessageEncoder = Encoder;
        constructor() {
            super(ctx, {}, "telegram");
            this.user = { id: "bot" };
            this.internal = {
                sendMessage: async () => {
                    sent++;
                },
            };
        }
    }
    const bot = new TelegramBot();
    const session = bot.session({ channel: { id: "7", type: 0 }, guild: { id: "-1001" } });
    await ctx.start();
    onTestFinished(() => ctx.stop());
    return { bot, session, blocked: () => blocked, sent: () => sent };
}

it("supplies the parent guild at the initial Telegram topic send guard", async () => {
    const f = await fixture();
    const seen: any[] = [];
    await withReplyTurn(
        () => true,
        async () => {
            await guardReplyBot(f.bot).sendMessage("7", "hello", undefined, { session: f.session });
        },
        undefined,
        (target) => {
            seen.push(target);
            return true;
        },
    );
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((target) => target.guildId === "-1001")).toBe(true);
});

it("rechecks parent-qualified topic suppression at the last outbound operation", async () => {
    const f = await fixture();
    await withReplyTurn(
        () => true,
        async () => {
            await expect(guardReplyBot(f.bot).sendMessage("7", "hello", undefined, { session: f.session })).rejects.toThrow(/抑制/);
        },
        undefined,
        (target) => !(f.blocked() && target.guildId === "-1001" && target.channelId === "7"),
    );
    expect(f.sent()).toBe(0);
});
