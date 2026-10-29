import { Bot, Context, MessageEncoder, Universal } from "koishi";
import { expect, it } from "vitest";

import { withReplyTurn, withReplyTurnGuard, assertReplyTurn, guardReplySession } from "../src/agent/reply-turn";

it("retains confirmed encoder deliveries when a later request fails without retrying", async () => {
    const ctx = new Context();
    const failure = new Error("second request failed");
    let attempts = 0;
    class Encoder extends MessageEncoder {
        async visit() {
            attempts++;
            this.results.push({ id: "confirmed", content: "first" }, { id: "" }, { id: "   " }, { id: 42 } as any);
            this.errors.push(failure);
        }
        async flush() {}
    }
    class SendingBot extends Bot {
        static MessageEncoder = Encoder;
    }
    const bot = new SendingBot(ctx, {} as any, "qq");
    bot.user = { id: "bot" };
    const session = bot.session({ channel: { id: "group" } });
    const error = await withReplyTurn(
        () => true,
        () => guardReplySession(session).bot.sendMessage("group", "reply"),
    ).catch((error) => error);
    expect(error.messages).toEqual([{ id: "confirmed", content: "first" }]);
    expect(error.cause.errors).toEqual([failure]);
    expect(attempts).toBe(1);
    await ctx.stop();
});

it("preserves the original encoder failure when nothing was confirmed", async () => {
    const ctx = new Context();
    const failure = new Error("upload failed");
    class Encoder extends MessageEncoder {
        async visit() {
            throw failure;
        }
        async flush() {}
    }
    class SendingBot extends Bot {
        static MessageEncoder = Encoder;
    }
    const bot = new SendingBot(ctx, {} as any, "qq");
    bot.user = { id: "bot" };
    const session = bot.session({ channel: { id: "group" } });
    await expect(
        withReplyTurn(
            () => true,
            () => guardReplySession(session).bot.sendMessage("group", "reply"),
        ),
    ).rejects.toBe(failure);
    await ctx.stop();
});

it("keeps cancellation effective after an encoder has confirmed an earlier delivery", async () => {
    const ctx = new Context();
    const controller = new AbortController();
    let laterRequests = 0;
    class Encoder extends MessageEncoder {
        async visit() {
            this.results.push({ id: "confirmed" });
            controller.abort();
        }
        async flush() {
            laterRequests++;
        }
    }
    class SendingBot extends Bot {
        static MessageEncoder = Encoder;
    }
    const bot = new SendingBot(ctx, {} as any, "qq");
    bot.user = { id: "bot" };
    const session = bot.session({ channel: { id: "group" } });
    const error = await withReplyTurn(
        () => true,
        () => guardReplySession(session).bot.sendMessage("group", "reply"),
        controller.signal,
    ).catch((error) => error);
    expect(error.messages).toEqual([{ id: "confirmed" }]);
    expect(error.cause.name).toBe("AbortError");
    expect(laterRequests).toBe(0);
    await ctx.stop();
});

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
            if (transport === "guild") await this.bot.internal.sendGuildChannelMsg("guild", this.channelId, this.#marker);
            else if (transport === "internal" && ["qq", "qqguild"].includes(platform))
                await this.bot.internal[this.channelId === "real-dm" ? "sendDM" : "sendMessage"](this.channelId, this.#marker);
            else if (transport === "internal") await this.bot.internal.sendGroupMsg(this.channelId, this.#marker);
            else if (transport === "contract") await (this.bot as any).deliverContract(this.channelId);
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
    class QQInternal {
        #marker = "qq-internal";
        async sendMessage(id: string) {
            expect(this.#marker).toBe("qq-internal");
            deliveries.push(id);
        }
        async sendDM(id: string) {
            expect(this.#marker).toBe("qq-internal");
            deliveries.push(id);
        }
    }
    class LegacyGuildInternal {
        #marker = "legacy-internal";
        async sendGuildChannelMsg(_guild: string, id: string) {
            expect(this.#marker).toBe("legacy-internal");
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
    if (transport === "guild") bot.internal = new LegacyGuildInternal();
    else if (["qq", "qqguild"].includes(platform)) bot.internal = new QQInternal();
    else if (platform !== "onebot") bot.internal = new Internal();
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

for (const platform of ["discord", "onebot", "qq", "qqguild"]) {
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

for (const revoke of ["history", "parent", "destination"] as const)
    it(`preserves ${revoke} restrictions when heartbeat rewraps an AgentCore session`, async () => {
        let entered!: () => void, release!: () => void;
        const started = new Promise<void>((resolve) => (entered = resolve));
        const gate = new Promise<void>((resolve) => (release = resolve));
        const f = await encoderFixture("discord", "nested-bot", true, async () => {
            entered();
            await gate;
        });
        const parent = new AbortController(),
            history = new AbortController();
        let allowed = true;
        try {
            const sending = withReplyTurn(
                () => true,
                () => {
                    const session = guardReplySession(f.session);
                    return withReplyTurnGuard(
                        () => true,
                        () => guardReplySession(session).bot.sendMessage("group", "old"),
                        history.signal,
                    );
                },
                parent.signal,
                () => allowed,
            );
            void sending.catch(() => {});
            await started;
            if (revoke === "history") history.abort();
            else if (revoke === "parent") parent.abort();
            else allowed = false;
            release();
            await expect(sending).rejects.toThrow(revoke === "destination" ? "抑制" : "取消");
            expect(f.deliveries).toEqual([]);
        } finally {
            await f.bot.dispose();
            await f.ctx.stop();
        }
    });
it("cannot revive an old guarded session by wrapping it in a fresh turn", async () => {
    const f = await encoderFixture("discord");
    const old = new AbortController();
    const session = withReplyTurn(
        () => true,
        () => guardReplySession(f.session),
        old.signal,
    );
    old.abort();
    try {
        await withReplyTurn(
            () => true,
            async () => {
                await expect(guardReplySession(session).bot.sendMessage("group", "old")).rejects.toThrow("取消");
            },
        );
        expect(f.deliveries).toEqual([]);
    } finally {
        await f.ctx.stop();
    }
});

for (const platform of ["qq", "qqguild"])
    for (const transport of ["internal", "http-post", "http-call"])
        for (const privateReceiver of [false, true])
            it(`blocks late ${platform} ${transport} sends with ${privateReceiver ? "private" : "ordinary"} receivers`, async () => {
                let entered!: () => void, release!: () => void;
                const started = new Promise<void>((resolve) => (entered = resolve));
                const gate = new Promise<void>((resolve) => (release = resolve));
                let valid = true,
                    first = true;
                const f = await encoderFixture(
                    platform,
                    "qq-bot",
                    privateReceiver,
                    async () => {
                        if (!first) return;
                        first = false;
                        entered();
                        await gate;
                    },
                    transport,
                );
                try {
                    const sending = withReplyTurn(
                        () => valid,
                        () => guardReplySession(f.session).bot.sendPrivateMessage("user", "old"),
                    );
                    // Attach before waiting so receiver errors remain observable without unhandled rejections.
                    const outcome = sending.then(
                        () => undefined,
                        (error) => error,
                    );
                    await Promise.race([
                        started,
                        outcome.then((error) => {
                            if (error) throw error;
                        }),
                    ]);
                    valid = false;
                    expect(await f.bot.sendMessage("ordinary", "command")).toEqual(["sent"]);
                    release();
                    expect((await outcome)?.message).toContain("取消");
                    expect(f.deliveries).toEqual(["ordinary"]);
                    expect(Object.hasOwn(f.bot, "constructor")).toBe(false);
                } finally {
                    release();
                    if (privateReceiver) await f.bot.dispose();
                    await f.ctx.stop();
                }
            });

it("keeps legacy OneBot qqguild sends guarded at sendGuildChannelMsg", async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    let valid = true;
    const f = await encoderFixture("qqguild", "legacy-bot", false, undefined, "guild");
    f.ctx.on("before-send", async () => {
        entered();
        await gate;
    });
    try {
        const sending = withReplyTurn(
            () => valid,
            () => guardReplySession(f.session).bot.sendMessage("group", "old"),
        ).catch((error) => error);
        await started;
        valid = false;
        release();
        await sending;
        expect(f.deliveries).toEqual([]);
        expect(await f.bot.sendMessage("ordinary", "command")).toEqual(["sent"]);
        expect(f.deliveries).toEqual(["ordinary"]);
    } finally {
        release();
        await f.ctx.stop();
    }
});

for (const platform of ["qq", "qqguild"]) {
    it(`preserves ${platform} routed direct category at initial and encoder checks`, async () => {
        const f = await encoderFixture(platform);
        const routing = f.bot.session({ type: "message", channel: { id: "native-dm", type: Universal.Channel.Type.DIRECT }, user: { id: "user" } });
        const destinations: Array<{ channelId: string; isDirect?: boolean }> = [];
        try {
            expect(routing.isDirect).toBe(true);
            const sent = await withReplyTurn(
                () => true,
                () => guardReplySession(f.session).bot.sendMessage("native-dm", "reply", undefined, { session: routing }),
                undefined,
                (target) => {
                    destinations.push({ channelId: target.channelId, isDirect: target.isDirect });
                    return target.isDirect === true;
                },
            );
            expect(sent).toEqual(["sent"]);
            expect(f.deliveries).toEqual(["native-dm"]);
            expect(destinations.length).toBeGreaterThan(1);
            expect(destinations.every((target) => target.channelId === "native-dm" && target.isDirect === true)).toBe(true);
        } finally {
            await f.ctx.stop();
        }
    });

    it(`rechecks ${platform} routed direct suppression after asynchronous encoder preparation`, async () => {
        let allowed = true;
        const f = await encoderFixture(platform, "qq-bot", false, async () => {
            allowed = false;
        });
        const routing = f.bot.session({ type: "message", channel: { id: "native-dm", type: Universal.Channel.Type.DIRECT }, user: { id: "user" } });
        try {
            const sent = withReplyTurn(
                () => true,
                () => guardReplySession(f.session).bot.sendMessage("native-dm", "reply", undefined, { session: routing }),
                undefined,
                (target) => target.isDirect !== true || allowed,
            );
            await expect(sent).rejects.toThrow("抑制");
            expect(f.deliveries).toEqual([]);
        } finally {
            await f.ctx.stop();
        }
    });
}

// Source-derived outbound contracts, not full adapter integration: satorijs/satori
// 7606a0c3bd1ec7756a893bfce4129db9548df213, adapters/{lark,slack,discord,telegram,kook}/src/message.ts.
// Keep the real Koishi Bot.sendMessage / MessageEncoder lifecycle and local transport sinks.
for (const contract of [
    "lark:create",
    "lark:reply",
    "lark:patch",
    "lark:update",
    "lark:image",
    "lark:file",
    "slack:text",
    "slack:upload",
    "discord:thread",
    "discord:channel",
    "telegram:media",
    "kook:post",
]) {
    for (const revoke of ["cancel", "destination"])
        it(`rechecks ${revoke} at the stable-v4 ${contract} outbound capability captured before asynchronous preparation`, async () => {
            const platform = contract.split(":")[0];
            const f = await encoderFixture(platform, "contract-bot", true, undefined, "contract");
            let entered!: () => void,
                release!: () => void,
                valid = true,
                first = true,
                reads = 0;
            const started = new Promise<void>((resolve) => (entered = resolve));
            const gate = new Promise<void>((resolve) => (release = resolve));
            class Endpoint {
                #marker = "endpoint";
                get marker() {
                    return this.#marker;
                }
                async get() {
                    expect(this.#marker).toBe("endpoint");
                    reads++;
                }
                async create(id: string) {
                    expect(this.#marker).toBe("endpoint");
                    f.deliveries.push(id);
                }
                reply = this.create;
                patch = this.create;
                update = this.create;
                chatPostMessage = this.create;
                startThreadFromMessage = this.create;
                modifyChannel = this.create;
                sendMediaGroup = this.create;
            }
            class Namespace {
                #endpoint = new Endpoint();
                get message() {
                    return this.#endpoint;
                }
                get image() {
                    return this.#endpoint;
                }
                get file() {
                    return this.#endpoint;
                }
            }
            const endpoint = new Endpoint();
            f.bot.internal = platform === "lark" ? { im: new Namespace() } : endpoint;
            // Slack.request reads this.http on the bot; Internal.chatPostMessage instead
            // retains its own HTTP client, so the internal capability needs its own check.
            f.bot.request = async function (_method: string, path: string, id: string) {
                await this.http.post(path, id);
            };
            f.bot.http = {
                post: async (_path: string, id: string) => {
                    f.deliveries.push(id);
                },
            };
            f.bot.deliverContract = async function (id: string) {
                const api =
                    platform === "lark" ? this.internal.im[contract === "lark:image" ? "image" : contract === "lark:file" ? "file" : "message"] : this.internal;
                const method = contract.startsWith("lark:")
                    ? ["image", "file"].includes(contract.split(":")[1])
                        ? "create"
                        : contract.split(":")[1]
                    : contract === "slack:text"
                      ? "chatPostMessage"
                      : contract === "discord:thread"
                        ? "startThreadFromMessage"
                        : contract === "discord:channel"
                          ? "modifyChannel"
                          : "sendMediaGroup";
                const send = api[method].bind(api);
                if (platform === "lark") expect(api.marker).toBe("endpoint");
                if (first) {
                    first = false;
                    entered();
                    await gate;
                }
                // Cancellation must leave preparation/read APIs callable.
                await api.get();
                if (contract === "slack:upload") await this.request("POST", "/files.upload", id);
                else if (contract === "kook:post") await this.http.post("/message/create", id);
                else await send(id);
            };
            try {
                const pending = withReplyTurn(
                    () => revoke === "destination" || valid,
                    () => guardReplySession(f.session).bot.sendMessage("old", "reply"),
                    undefined,
                    () => revoke !== "destination" || valid,
                );
                const outcome = pending.catch((error) => error);
                await started;
                valid = false;
                expect(await f.bot.sendMessage("ordinary", "command")).toEqual(["sent"]);
                expect(
                    await withReplyTurn(
                        () => true,
                        () => guardReplySession(f.session).bot.sendMessage("fresh", "reply"),
                    ),
                ).toEqual(["sent"]);
                release();
                expect((await outcome)?.message).toContain(revoke === "destination" ? "抑制" : "取消");
                expect(f.deliveries).toEqual(["ordinary", "fresh"]);
                expect(reads).toBe(3);
                expect(Object.hasOwn(f.bot, "constructor")).toBe(false);
            } finally {
                release();
                await f.bot.dispose();
                await f.ctx.stop();
            }
        });
}

it("blocks the stable-v4 Lark reply after an awaited thread lookup inside post", async () => {
    const f = await encoderFixture("lark", "lark-bot", true, undefined, "contract");
    let entered!: () => void,
        release!: () => void,
        valid = true;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    // LarkMessageEncoder.post: card.action.trigger first resolves thread metadata,
    // then invokes im.message.reply; no new encoder stage begins between the two.
    class Messages {
        #marker = "messages";
        async get(_id: string) {
            expect(this.#marker).toBe("messages");
            entered();
            await gate;
            return { items: [{ thread_id: "thread" }] };
        }
        async reply(_id: string, payload: { channel: string; reply_in_thread: boolean }) {
            expect(this.#marker).toBe("messages");
            f.deliveries.push(payload.channel);
        }
    }
    f.bot.internal = { im: { message: new Messages() } };
    f.bot.deliverContract = async function (channel: string) {
        const {
            items: [message],
        } = await this.internal.im.message.get("card-message");
        if (message.thread_id) await this.internal.im.message.reply("card-message", { channel, reply_in_thread: true });
    };
    try {
        const pending = withReplyTurn(
            () => valid,
            () => guardReplySession(f.session).bot.sendMessage("old", "reply"),
        );
        const outcome = pending.catch((error) => error);
        await started;
        valid = false;
        release();
        expect((await outcome)?.message).toContain("取消");
        expect(f.deliveries).toEqual([]);
        expect(await f.bot.sendMessage("ordinary", "command")).toEqual(["sent"]);
        expect(f.deliveries).toEqual(["ordinary"]);
    } finally {
        release();
        await f.bot.dispose();
        await f.ctx.stop();
    }
});
