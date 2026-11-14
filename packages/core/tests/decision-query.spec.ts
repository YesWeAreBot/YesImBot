import { Context, type Session } from "koishi";
import { expect, it } from "vitest";

import { registerDecisionCommands } from "../src/agent/decision-commands";
import { ReplyControl } from "../src/agent/reply-control";
import { WorldStateService } from "../src/world/service";

it("queries only the current conversation with administrator authority even without a history callback", async (t) => {
    const ctx = new Context();
    t.onTestFinished(() => ctx.stop());
    const session = { platform: "qq", selfId: "bot", channelId: "g", isDirect: false } as Session;
    let calls = 0;
    registerDecisionCommands(ctx, (value) => {
        expect(value).toBe(session);
        calls++;
        return "saved roll 0.7";
    });
    const command = ctx.$commander.get("chat.decision")!;
    expect(command.config.authority).toBe(3);
    const action = Reflect.get(command, "_actions")[0];
    expect(await action({ session, options: command.parse("").options })).toBe("saved roll 0.7");
    expect(await action({ session, options: command.parse("--history").options })).toContain("未启用本地决策记录");
    expect(await action({ session: undefined })).toContain("群聊或私聊");
    expect(calls).toBe(1);
});

it("reads an expired bot mute without removing live state", () => {
    const world: any = Object.create(WorldStateService.prototype);
    world.mutedChannels = new Map([["qq:g", Date.now() - 1]]);
    world.allMutedChannels = new Map();
    expect(world.peekBotMuted("qq:g")).toBe(false);
    expect(world.mutedChannels.has("qq:g")).toBe(true);
});

it("reading an expired suppression rule does not clear it, cancel tasks, or write storage", async () => {
    let now = 0;
    let changes = 0;
    let removes = 0;
    const control = new ReplyControl(
        {
            load: async () => [],
            save: async () => {},
            remove: async () => {
                removes++;
            },
        },
        () => {
            changes++;
        },
        async () => {},
        () => now,
    );
    const target = { platform: "qq", selfId: "bot", channelId: "g" };
    await control.set(target, ["text"], 10);
    const before = changes;
    now = 11;
    expect(control.peek(target)).toBeUndefined();
    expect(changes).toBe(before);
    expect(removes).toBe(0);
    now = 0;
    expect(control.peek(target)?.blocked).toEqual(["text"]);
});
