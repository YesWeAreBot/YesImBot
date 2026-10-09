import { expect, it } from "vitest";

import { registerDecisionCommands } from "../src/agent/decision-commands";
import { ReplyControl } from "../src/agent/reply-control";
import { WorldStateService } from "../src/services/worldstate/service";

it("queries only the current conversation with administrator authority", async () => {
    let action: any;
    let commandName: string;
    let authority: number;
    const session: any = { platform: "qq", selfId: "bot", channelId: "g", isDirect: false };
    const ctx: any = {
        command(name: string, _text: string, config: any) {
            commandName = name;
            authority = config.authority;
            return {
                action(fn: any) {
                    action = fn;
                    return this;
                },
            };
        },
    };
    let calls = 0;
    registerDecisionCommands(ctx, (value: any) => {
        expect(value).toBe(session);
        calls++;
        return "saved roll 0.7";
    });
    expect(commandName!).toBe("chat.decision");
    expect(authority!).toBe(3);
    expect(await action({ session })).toBe("saved roll 0.7");
    expect(calls).toBe(1);
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
