import { expect, it, spyOn } from "bun:test";
import { Bot, Context, MessageEncoder } from "koishi";
import { EventListenerManager } from "../src/services/worldstate/event-listener";
import { Services } from "../src/shared/constants";

async function fixture() {
    const ctx = new Context();
    const events: any[] = [];
    ctx[Services.Logger] = { getLogger: () => ({ debug() {}, info() {}, error() {} }) } as any;
    ctx.database = {
        get: async (_table: string, query: any) => events.filter(e => e.id === query.id),
        set: async (_table: string, query: any, update: any) => Object.assign(events.find(e => e.id === query.id), update),
    } as any;
    const service = { recordSystemEvent: async (event: any) => { events.push(event); }, isChannelAllowed: () => true };
    const manager: any = new EventListenerManager(ctx, service as any, {} as any);
    // Exercise the actual command + encoder hooks, without database observation on Session.execute.
    let clean!: () => void;
    const interval = spyOn(globalThis, "setInterval").mockImplementation((callback: any) => {
        clean = callback;
        return 0 as any;
    });
    manager.start();
    interval.mockRestore();
    class Encoder extends MessageEncoder {
        async visit() {}
        async flush() { this.results.push({ id: "sent" }); }
    }
    class SendingBot extends Bot { static MessageEncoder = Encoder; }
    const session = (platform: string, messageId: string) => {
        const bot: any = Object.create(SendingBot.prototype);
        Object.assign(bot, { ctx, context: ctx, config: {}, platform, user: { id: "bot" }, callbacks: {} });
        const s: any = bot.session({ type: "message", channel: { id: "same" }, user: { id: "user", name: "User" }, message: { id: messageId } });
        s.scope = "commands.echo.messages";
        s.send = ctx.koishi.session.send;
        return s;
    };
    await ctx.start();
    return { ctx, manager, events, service, session, clean: () => clean(),
        stop: async () => { manager.stop(); await ctx.stop(); } };
}

it("matches real encoder results by originating command session across platforms and reversed concurrent replies", async () => {
    const f = await fixture();
    try {
        const cmd = f.ctx.command("echo").action(({ session }) => session.messageId === "silent" ? "" : session.messageId);
        const a = f.session("onebot", "silent"), b = f.session("discord", "b");
        await cmd.execute({ session: a } as any);
        await b.send(await cmd.execute({ session: b } as any));
        expect(f.events.find(e => e.platform === "onebot").payload.result).toBeUndefined();
        expect(f.events.find(e => e.platform === "discord").payload.result).toBe("b");
        const c = f.session("discord", "c"), d = f.session("discord", "d");
        const cResult = await cmd.execute({ session: c } as any);
        const dResult = await cmd.execute({ session: d } as any);
        await d.send(dResult);
        await c.send(cResult);
        expect(f.events.find(e => e.id.startsWith("cmd_invoked_c_"))?.payload.result).toBe("c");
        expect(f.events.find(e => e.id.startsWith("cmd_invoked_d_"))?.payload.result).toBe("d");
    } finally { await f.stop(); }
});

it("rejects expired calls at match time, cleans periodically, and clears pending state on stop", async () => {
    const f = await fixture();
    const clock = spyOn(Date, "now").mockReturnValue(1000);
    try {
        const s = f.session("discord", "expired");
        await f.manager.handleCommandInvocation({ session: s, command: { name: "echo" } });
        clock.mockReturnValue(301000);
        const outbound = f.session("discord", "outbound");
        outbound.content = "late";
        await f.manager.matchCommandResult(outbound, { session: s });
        expect(f.events[0].payload.result).toBeUndefined();
        expect(f.manager.pendingCommands.size).toBe(0);
        await f.manager.handleCommandInvocation({ session: s, command: { name: "echo" } });
        clock.mockReturnValue(601000);
        f.clean();
        expect(f.manager.pendingCommands.size).toBe(0);
        await f.manager.handleCommandInvocation({ session: s, command: { name: "echo" } });
        const clear = spyOn(globalThis, "clearInterval");
        f.manager.stop();
        expect(clear).toHaveBeenCalled();
        clear.mockRestore();
        expect(f.manager.pendingCommands.size).toBe(0);
        expect(f.manager.cleanupTimer).toBeUndefined();
    } finally { clock.mockRestore(); await f.stop(); }
});

it("does not revive pending commands when a recording operation finishes after stop and restart", async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.service.recordSystemEvent = async event => { f.events.push(event); await gate; };
    try {
        const pending = f.manager.handleCommandInvocation({ session: f.session("discord", "late-record"), command: { name: "echo" } });
        f.manager.stop();
        f.manager.start();
        release();
        await pending;
        expect(f.manager.pendingCommands.size).toBe(0);
    } finally { release(); await f.stop(); }
});

it("does not guess between same-session same-scope invocations or unrelated sends", async () => {
    const f = await fixture();
    try {
        const s = f.session("discord", "shared");
        await f.manager.handleCommandInvocation({ session: s, command: { name: "echo" } });
        await f.manager.handleCommandInvocation({ session: s, command: { name: "echo" } });
        expect(new Set(f.events.map(e => e.id)).size).toBe(2);
        await s.send("ambiguous");
        expect(f.events.every(e => e.payload.result === undefined)).toBe(true);
    } finally { await f.stop(); }
});
