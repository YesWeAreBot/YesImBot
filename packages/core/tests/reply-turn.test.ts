import { expect, it } from "bun:test";

import { Bot, Context, MessageEncoder } from "koishi";

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
        },
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
        (target) => target.channelId !== "paused",
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
        },
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
        (target) => target.isDirect === true,
    );
    expect(delivered).toBe("real-dm");
});

async function encoderFixture(
    platform = "discord",
    selfId = "bot-a",
    privateReceiver = false,
    prepare?: () => Promise<void>,
    transport = "internal",
    stage = "flush",
) {
    const ctx = new Context();
    const deliveries: string[] = [];
    class Encoder extends MessageEncoder {
        #marker = "reply";
        async visit() {}
        async deliver() {
            await prepare?.();
            if (transport === "internal") await this.bot.internal.sendGroupMsg(this.channelId, this.#marker);
            else if (transport === "http-call") await (this.bot as any).http("POST", this.channelId, { data: this.#marker });
            else await (this.bot as any).http.post(this.channelId, this.#marker);
        }
        async prepare() {
            if (stage === "prepare") await this.deliver();
        }
        async flush() {
            if (stage === "flush") await this.deliver();
            this.results.push({ id: "sent" });
        }
    }
    class SendingBot extends Bot {
        static MessageEncoder = Encoder;
    }
    class PrivateSendingBot extends SendingBot {
        #marker = "receiver";
        get receiverMarker() {
            return this.#marker;
        }
        constructor() {
            super(ctx, {} as any, platform);
        }
        async sendMessage(...args: Parameters<Bot["sendMessage"]>) {
            expect(this.#marker).toBe("receiver");
            return super.sendMessage(...args);
        }
    }
    if (privateReceiver) Object.defineProperty(ctx, "bots", { value: [], configurable: true });
    const bot: any = privateReceiver ? new PrivateSendingBot() : Object.create(SendingBot.prototype);
    Object.assign(bot, {
        ctx,
        context: ctx,
        config: {},
        platform,
        user: { id: selfId },
        callbacks: {},
        internal: {
            sendGroupMsg: async (id: string) => {
                deliveries.push(id);
            },
        },
        createDirectChannel: async () => ({ id: "real-dm" }),
    });
    class Internal {
        #marker = "internal";
        async sendGroupMsg(id: string) {
            expect(this.#marker).toBe("internal");
            deliveries.push(id);
        }
    }
    class Http {
        #marker = "http";
        async post(id: string) {
            expect(this.#marker).toBe("http");
            deliveries.push(id);
        }
    }
    if (platform !== "onebot") bot.internal = new Internal();
    bot.http =
        transport === "http-call"
            ? async (_method: string, id: string) => {
                  deliveries.push(id);
              }
            : new Http();
    await ctx.start();
    const session = bot.session({ type: "message", channel: { id: "group" }, user: { id: "user" } });
    // Use the real Koishi session mixin methods (the fixture bot bypasses registration).
    for (const key of ["send", "sendQueued", "_next"]) session[key] = ctx.koishi.session[key];
    return { ctx, bot, session, deliveries };
}

for (const platform of ["discord", "onebot"]) {
    for (const method of ["send", "sendQueued", "sendMessage", "sendPrivateMessage"] as const) {
        it(`cancels ${platform} ${method} after the real encoder before-send hook`, async () => {
            const f = await encoderFixture(platform);
            const controller = new AbortController();
            let entered!: () => void, release!: () => void;
            const started = new Promise<void>((resolve) => {
                entered = resolve;
            });
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            f.ctx.on("before-send", async () => {
                entered();
                await gate;
            });
            const pending = withReplyTurn(
                () => !controller.signal.aborted,
                async () => {
                    const session = guardReplySession(f.session);
                    return method === "send"
                        ? session.send("reply")
                        : method === "sendQueued"
                          ? session.sendQueued("reply", 0)
                          : method === "sendMessage"
                            ? session.bot.sendMessage("group", "reply")
                            : session.bot.sendPrivateMessage("user", "reply");
                },
                controller.signal,
            ).catch(() => []);
            await started;
            controller.abort(new Error("cancelTurn"));
            release();
            await pending;
            expect(f.deliveries).toEqual([]);
            expect(await f.bot.sendMessage("group", "ordinary")).toEqual(["sent"]);
            expect(f.deliveries).toEqual(["group"]);
            await f.ctx.stop();
        });
    }
}

it("keeps guarded encoder returns and cancellation isolated across turns and bot accounts", async () => {
    const a = await encoderFixture("discord", "bot-a");
    const b = await encoderFixture("discord", "bot-b");
    let valid = true;
    let guarded: any;
    await withReplyTurn(
        () => valid,
        async () => {
            guarded = guardReplySession(a.session);
        },
    );
    valid = false;
    await expect(guarded.bot.sendMessage("group", "old")).rejects.toThrow();
    await withReplyTurn(
        () => true,
        async () => {
            const session = guardReplySession(b.session);
            expect(await session.send("reply")).toEqual(["sent"]);
            expect(await session.sendQueued("reply", 0)).toEqual(["sent"]);
            expect(await session.bot.sendMessage("other-group", "reply")).toEqual(["sent"]);
            expect(await session.bot.sendPrivateMessage("user", "reply")).toEqual(["sent"]);
        },
    );
    expect(a.deliveries).toEqual([]);
    expect(b.deliveries).toEqual(["group", "group", "other-group", "real-dm"]);
    await a.ctx.stop();
    await b.ctx.stop();
});

for (const stage of ["flush", "prepare"])
    for (const transport of ["internal", "http-post", "http-call"]) {
        it(`rechecks ${transport} after asynchronous preparation inside real MessageEncoder.${stage}`, async () => {
            let entered!: () => void,
                release!: () => void,
                valid = true;
            const started = new Promise<void>((resolve) => {
                entered = resolve;
            });
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            let first = true;
            const f = await encoderFixture(
                "discord",
                "private-bot",
                true,
                async () => {
                    if (!first) return;
                    first = false;
                    entered();
                    await gate;
                },
                transport,
                stage,
            );
            const internal = f.bot.internal,
                http = f.bot.http;
            Object.defineProperty(f.bot, "internal", {
                configurable: true,
                enumerable: true,
                get() {
                    expect(this.receiverMarker).toBe("receiver");
                    return internal;
                },
            });
            Object.defineProperty(f.bot, "http", {
                configurable: true,
                enumerable: true,
                get() {
                    expect(this.receiverMarker).toBe("receiver");
                    return http;
                },
            });
            const internalDescriptor = Object.getOwnPropertyDescriptor(f.bot, "internal");
            const httpDescriptor = Object.getOwnPropertyDescriptor(f.bot, "http");
            const pending = withReplyTurn(
                () => valid,
                () => guardReplySession(f.session).bot.sendMessage("group", "old"),
            );
            await started;
            valid = false;
            expect(await f.bot.sendMessage("group", "ordinary")).toEqual(["sent"]);
            expect(
                await withReplyTurn(
                    () => true,
                    () => guardReplySession(f.session).bot.sendMessage("group", "fresh"),
                ),
            ).toEqual(["sent"]);
            release();
            await expect(pending).rejects.toThrow("取消");
            expect(f.deliveries).toEqual(["group", "group"]);
            expect(Object.getOwnPropertyDescriptor(f.bot, "internal")).toEqual(internalDescriptor);
            expect(Object.getOwnPropertyDescriptor(f.bot, "http")).toEqual(httpDescriptor);
            await f.bot.dispose();
            await f.ctx.stop();
        });
    }

for (const property of ["internal", "http"]) {
    it(`rejects protected sends with non-configurable ${property} and preserves ordinary sending`, async () => {
        const f = await encoderFixture();
        Object.defineProperty(f.bot, property, { value: f.bot[property], configurable: false, writable: true });
        const internal = Object.getOwnPropertyDescriptor(f.bot, "internal");
        const http = Object.getOwnPropertyDescriptor(f.bot, "http");
        await expect(
            withReplyTurn(
                () => true,
                () => guardReplySession(f.session).bot.sendMessage("group", "reply"),
            ),
        ).rejects.toThrow("不可配置");
        expect(Object.getOwnPropertyDescriptor(f.bot, "internal")).toEqual(internal);
        expect(Object.getOwnPropertyDescriptor(f.bot, "http")).toEqual(http);
        expect(Object.hasOwn(f.bot, "constructor")).toBe(false);
        expect(await f.bot.sendMessage("ordinary", "reply")).toEqual(["sent"]);
        expect(f.deliveries).toEqual(["ordinary"]);
        await f.ctx.stop();
    });
}

it("keeps a fresh nested turn protected after its own asynchronous preparation", async () => {
    let entered!: () => void,
        release!: () => void,
        oldValid = true,
        freshValid = true;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let first = true,
        hooked = false,
        freshError: Error | undefined;
    const f = await encoderFixture("discord", "bot", false, async () => {
        if (!first) return;
        first = false;
        entered();
        await gate;
        // 普通发送从旧 turn 的异步子链发起，仍使用自己的无保护编码器。
        expect(await f.bot.sendMessage("ordinary", "command")).toEqual(["sent"]);
    });
    f.ctx.on("before-send", async () => {
        if (hooked) return;
        hooked = true;
        oldValid = false;
        await withReplyTurn(
            () => freshValid,
            () => guardReplySession(f.session).bot.sendMessage("fresh", "reply"),
        ).catch((error) => {
            freshError = error;
        });
    });
    const pending = withReplyTurn(
        () => oldValid,
        () => guardReplySession(f.session).bot.sendMessage("old", "reply"),
    );
    await started;
    freshValid = false;
    release();
    await expect(pending).rejects.toThrow("取消");
    expect(freshError?.message).toContain("取消");
    expect(f.deliveries).toEqual(["ordinary"]);
    expect(Object.hasOwn(f.bot, "constructor")).toBe(false);
    await f.ctx.stop();
});

it("preserves private bot/encoder receivers and restores the constructor descriptor", async () => {
    const f = await encoderFixture("discord", "private-bot", true);
    const original = f.bot.constructor;
    const descriptor = { value: original, configurable: true, writable: false, enumerable: true };
    Object.defineProperty(f.bot, "constructor", descriptor);
    await withReplyTurn(
        () => true,
        async () => {
            const guarded = guardReplySession(f.session);
            expect((guarded.bot as any).receiverMarker).toBe("receiver");
            expect(await guarded.bot.sendMessage("group", "reply")).toEqual(["sent"]);
            expect(await guarded.bot.sendPrivateMessage("user", "reply")).toEqual(["sent"]);
        },
    );
    expect(f.bot.constructor).toBe(original);
    expect(Object.getOwnPropertyDescriptor(f.bot, "constructor")).toEqual(descriptor);
    expect(await f.bot.sendMessage("ordinary", "reply")).toEqual(["sent"]);
    // 真实 Bot 的登录事件需要尚未卸载的 satori 服务。
    await f.bot.dispose();
    await f.ctx.stop();
});

it("isolates simultaneous turns and ordinary sends on the same bot and restores after the last send", async () => {
    const f = await encoderFixture();
    const sibling = await encoderFixture("discord", "bot-b");
    // 两个账号共享同一个适配器类，确保没有修改共享 MessageEncoder。
    Object.setPrototypeOf(sibling.bot, Object.getPrototypeOf(f.bot));
    const original = f.bot.constructor;
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    f.ctx.on("before-send", async (session) => {
        if (session.channelId === "cancelled") {
            entered();
            await gate;
            expect(await f.bot.sendMessage("hook-command", "ordinary")).toEqual(["sent"]);
        }
    });
    let valid = true;
    const pending = withReplyTurn(
        () => valid,
        () => guardReplySession(f.session).bot.sendMessage("cancelled", "reply"),
    );
    await started;
    valid = false;
    await withReplyTurn(
        () => true,
        async () => {
            expect(await guardReplySession(f.session).bot.sendMessage("other-turn", "reply")).toEqual(["sent"]);
            expect(await guardReplySession(sibling.session).bot.sendMessage("sibling-turn", "reply")).toEqual(["sent"]);
        },
    );
    expect(sibling.bot.constructor).toBe(original);
    expect(sibling.deliveries).toEqual(["sibling-turn"]);
    expect(f.bot.constructor).toBe(original);
    expect(await f.bot.sendMessage("ordinary", "reply")).toEqual(["sent"]);
    release();
    await expect(pending).rejects.toThrow("取消");
    expect(f.deliveries).toEqual(["other-turn", "ordinary", "hook-command"]);
    expect(Object.hasOwn(f.bot, "constructor")).toBe(false);
    expect(f.bot.constructor).toBe(original);
    await f.ctx.stop();
    await sibling.ctx.stop();
});

it("rechecks target suppression after before-send and restores the instance on failure", async () => {
    const f = await encoderFixture();
    const original = f.bot.constructor;
    let allowed = true;
    f.ctx.on("before-send", async () => {
        allowed = false;
    });
    await withReplyTurn(
        () => true,
        async () => {
            await expect(guardReplySession(f.session).bot.sendMessage("group", "reply")).rejects.toThrow("抑制");
        },
        undefined,
        (target) => target.channelId !== "group" || allowed,
    );
    expect(f.deliveries).toEqual([]);
    expect(f.bot.constructor).toBe(original);
    expect(Object.hasOwn(f.bot, "constructor")).toBe(false);
    expect(await f.bot.sendMessage("group", "ordinary")).toEqual(["sent"]);
    await f.ctx.stop();
});

it("does not apply an old guard to ordinary or fresh-turn sends on the same bot and channel", async () => {
    const f = await encoderFixture();
    let valid = true,
        hooked = false;
    const outcomes: string[] = [];
    const options = Object.freeze({});
    f.ctx.on("before-send", async () => {
        if (hooked) return;
        hooked = true;
        valid = false;
        for (const [label, task] of [
            ["ordinary", () => f.bot.sendMessage("group", "ordinary")],
            [
                "fresh-turn",
                () =>
                    withReplyTurn(
                        () => true,
                        () => guardReplySession(f.session).bot.sendMessage("group", "fresh"),
                    ),
            ],
        ] as const) {
            try {
                expect(await task()).toEqual(["sent"]);
                outcomes.push(label);
            } catch {
                outcomes.push(`${label}-blocked`);
            }
        }
    });
    const pending = withReplyTurn(
        () => valid,
        () => guardReplySession(f.session).bot.sendMessage("group", "old", null, options),
    );
    await expect(pending).rejects.toThrow("取消");
    expect(outcomes).toEqual(["ordinary", "fresh-turn"]);
    expect(f.deliveries).toEqual(["group", "group"]);
    expect(Reflect.ownKeys(options)).toEqual([]);
    expect(Object.hasOwn(f.bot, "constructor")).toBe(false);
    await f.ctx.stop();
});
