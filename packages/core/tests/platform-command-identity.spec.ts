import memory from "@koishijs/plugin-database-memory";
import { Bot, Context } from "koishi";
import { OneBotBot } from "koishi-plugin-adapter-onebot";
import { expect, it, onTestFinished, vi } from "vitest";

import { withReplyTurn } from "../src/agent/reply-turn";
import CommandExtension from "../src/extension/builtin/command";

async function fixture(type: number) {
    const ctx = new Context();
    ctx.plugin(memory);
    await ctx.start();
    await ctx.database.prepared();
    onTestFinished(() => ctx.stop());
    await ctx.database.createUser("onebot", "human", { authority: 4, name: "Human" });
    await ctx.database.createUser("onebot", "bot", { authority: 1, name: "Bot account" });
    const outbound: Array<{ channelId: string; content: string; actor: string }> = [];
    const bot: any = Object.assign(Object.create(Bot.prototype), {
        ctx,
        context: ctx,
        platform: "onebot",
        user: { id: "bot", name: "Bot" },
        callbacks: {},
        config: {},
        async sendMessage(channelId: string, elements: any[], _referrer: unknown, options: any) {
            // Exercise Koishi's real <execute> transformation, including user observation.
            const result = await options.session.transform(elements);
            outbound.push({ channelId, content: result.join(""), actor: options.session.userId });
            return ["sent"];
        },
    });
    // The fixture bypasses adapter registration; attach the real Koishi mixin
    // to every new session so execution and database observation remain real.
    const createSession = bot.session.bind(bot);
    bot.session = (event: any) => {
        const session = createSession(event);
        for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(Object.getPrototypeOf(ctx.koishi.session)))) {
            if (name !== "constructor" && typeof descriptor.value === "function") session[name] = descriptor.value;
        }
        return session;
    };
    const source = bot.session({
        type: "message",
        channel: { id: type === 1 ? "private:human" : "room", type },
        guild: type === 0 ? { id: "guild" } : undefined,
        user: { id: "human", name: "Human" },
        member: type === 0 ? { nick: "Human nick", roles: ["owner"] } : undefined,
        message: { id: "trigger", content: "ask bot" },
    });
    await source.observeUser(["authority", "permissions", "locales", "name"]);
    const extension = new CommandExtension(ctx, {});
    return { ctx, source, extension, outbound };
}

it("keeps cancellation protection when creating the bot command session", async () => {
    const f = await fixture(1);
    let invoked = false;
    f.ctx.command("cancelled").action(() => {
        invoked = true;
        return "should not run";
    });
    const result = await withReplyTurn(
        () => false,
        () => f.extension.executeKoishiCommand({ session: f.source, command: "cancelled" } as any),
    );
    expect(result.status).toBe("error");
    expect(invoked).toBe(false);
    expect(f.outbound).toEqual([]);
});

for (const [name, type] of [
    ["group", 0],
    ["private", 1],
] as const) {
    it(`executes ${name} commands as the bot account and keeps the original reply target`, async () => {
        const f = await fixture(type);
        const originalEvent = structuredClone(f.source.event);
        const originalUser = f.source.user;
        let execution: any;
        f.ctx
            .command("whoami")
            .userFields(["name", "authority"])
            .action(async ({ session }) => {
                execution = session;
                const before = { actor: session!.userId, name: session!.user!.name, authority: session!.user!.authority };
                session!.user!.name = "Bot updated";
                await session!.user!.$update();
                return JSON.stringify(before);
            });
        const result = await f.extension.executeKoishiCommand({ session: f.source, command: "whoami" } as any);
        expect(result.status).toBe("success");
        expect(JSON.parse(f.outbound[0].content)).toEqual({ actor: "bot", name: "Bot account", authority: 1 });
        expect(f.outbound[0].channelId).toBe(f.source.channelId);
        expect(f.outbound[0].actor).toBe("bot");
        expect(execution).not.toBe(f.source);
        expect(execution.isDirect).toBe(type === 1);
        expect(execution.guildId).toBe(f.source.guildId);
        expect(execution.event.member).toBeUndefined();
        expect(execution.messageId).not.toBe(f.source.messageId);
        expect(f.source.event).toEqual(originalEvent);
        expect(f.source.user).toBe(originalUser);
        expect(f.source.user.name).toBe("Human");
        expect((await f.ctx.database.getUser("onebot", "human"))!.name).toBe("Human");
        expect((await f.ctx.database.getUser("onebot", "bot"))!.name).toBe("Bot updated");
    });
    it(`does not inherit the triggering administrator's authority in ${name}`, async () => {
        const f = await fixture(type);
        let invoked = false;
        f.ctx.command("restricted", { authority: 3 }).action(() => {
            invoked = true;
            return "should not run";
        });
        await f.extension.executeKoishiCommand({ session: f.source, command: "restricted" } as any);
        expect(invoked).toBe(false);
        expect(f.source.user.authority).toBe(4);
        expect(f.outbound[0].actor).toBe("bot");
    });
}

for (const role of ["admin", "owner"]) {
    it(`uses the bot's own ${role} membership for native permission checks`, async () => {
        const f = await fixture(0);
        f.source.bot.checkPermission = OneBotBot.prototype.checkPermission;
        f.source.bot.getGuildMember = vi.fn<(guildId: string, userId: string) => Promise<any>>(async () => ({
            user: { id: "bot" },
            nick: "Bot member",
            roles: [{ id: role }],
        }));
        let actor: string | undefined;
        f.ctx.command("native-role", { permissions: [`onebot.group.${role}`] }).action(({ session }) => {
            actor = session!.userId;
            expect(session!.author.nick).toBe("Bot member");
            return "allowed";
        });
        await f.extension.executeKoishiCommand({ session: f.source, command: "native-role" } as any);
        expect(actor).toBe("bot");
        expect(f.source.bot.getGuildMember).toHaveBeenCalledWith("guild", "bot");
        expect(f.source.event.member.nick).toBe("Human nick");
    });
}

it("makes native adapter APIs available without copying the triggering user's raw payload", async () => {
    const f = await fixture(0);
    f.source.bot.internal = { getLoginInfo: async () => ({ user_id: "bot" }) };
    f.source.setInternal("onebot", { user_id: "human", sender: { role: "owner" }, message_id: "trigger" });
    let observed: any;
    f.ctx.command("native-api").action(async ({ session }) => {
        observed = { result: await session!.onebot!.getLoginInfo(), rawUser: session!.onebot!.user_id, actor: session!.userId };
        return "native API called";
    });
    await f.extension.executeKoishiCommand({ session: f.source, command: "native-api" } as any);
    expect(observed).toEqual({ result: { user_id: "bot" }, rawUser: undefined, actor: "bot" });
    expect(f.source.onebot.user_id).toBe("human");
});

it("does not replace a missing bot role with the triggering owner's membership", async () => {
    const f = await fixture(0);
    f.source.bot.checkPermission = OneBotBot.prototype.checkPermission;
    f.source.event.member.roles = [{ id: "owner" }];
    f.source.bot.getGuildMember = async () => ({ user: { id: "bot" }, roles: [{ id: "member" }] });
    let invoked = false;
    f.ctx.command("owner-only", { permissions: ["onebot.group.owner"] }).action(() => {
        invoked = true;
        return "not permitted";
    });
    await f.extension.executeKoishiCommand({ session: f.source, command: "owner-only" } as any);
    expect(invoked).toBe(false);
    expect(f.outbound[0].content).toContain("权限不足");
});
