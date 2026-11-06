import { expect, it, vi } from "vitest";

import { AgentCore } from "../src/agent/agent-core";
import { loggingStub } from "./helpers/yesimbot";

function fixture() {
    const listeners = new Map<string, Function[]>();
    let finish!: () => void;
    const initialized = new Promise<void>((resolve) => {
        finish = resolve;
    });
    let allowed = true;
    let generation = 0;
    const command: any = {};
    for (const method of ["action", "option", "alias", "usage", "example", "subcommand"]) command[method] = () => command;
    const ctx: any = {
        on: (event: string, callback: Function) => {
            const list = listeners.get(event) ?? [];
            listeners.set(event, [...list, callback]);
            return () =>
                listeners.set(
                    event,
                    (listeners.get(event) ?? []).filter((item) => item !== callback),
                );
        },
        filter: () => allowed,
        model: { extend() {} },
        command: () => command,
        setInterval: () => () => {},
        database: { get: () => initialized.then(() => []), upsert: async () => {}, remove: async () => {} },
    };
    const core: any = new AgentCore(ctx, {} as any, {
        logging: loggingStub(),
        world: { stimulusOwnerId: "owner", isChannelAllowed: () => true, l2_manager: { getHistoryGeneration: () => generation } } as any,
        model: { useChatGroup: () => ({}) } as any,
        prompt: { registerTemplate() {}, registerSnippet() {} } as any,
        tool: {} as any,
        asset: {} as any,
        memory: {} as any,
    });
    const received: string[] = [];
    core.receiveStimulus = (stimulus: any) => received.push(stimulus.session.messageId);
    core.willing.startDecayCycle = vi.fn<() => void>();
    const emit = (id: string, owner = "owner") => {
        for (const listener of listeners.get("agent/stimulus") ?? []) {
            listener({ type: "user_message", session: { platform: "qq", channelId: "g", selfId: "bot", messageId: id } }, owner);
        }
    };
    return {
        core,
        finish,
        received,
        emit,
        listeners,
        disallow: () => {
            allowed = false;
        },
        clearHistory: () => {
            generation++;
        },
    };
}

it("replays stimuli received before and during startup only after reply rules initialize", async () => {
    const f = fixture();
    f.emit("before-start");
    const starting = f.core.start();
    f.emit("during-start");
    f.emit("foreign-instance", "another-owner");
    expect(f.received).toEqual([]);
    f.finish();
    await starting;
    f.emit("after-start");
    expect(f.received).toEqual(["before-start", "during-start", "after-start"]);
});

it("rechecks the plugin scope before replaying queued stimuli", async () => {
    const f = fixture();
    f.emit("revoked");
    const starting = f.core.start();
    f.disallow();
    f.finish();
    await starting;
    expect(f.received).toEqual([]);
});

it("does not replay startup stimuli after the plugin is disposed", async () => {
    const f = fixture();
    const starting = f.core.start();
    f.emit("old");
    for (const listener of f.listeners.get("dispose") ?? []) listener();
    f.finish();
    await starting;
    f.emit("late");
    expect(f.received).toEqual([]);
});

it("does not replay a queued stimulus after its conversation history is cleared", async () => {
    const f = fixture();
    f.emit("cleared");
    const starting = f.core.start();
    f.clearHistory();
    f.emit("current");
    f.finish();
    await starting;
    expect(f.received).toEqual(["current"]);
});
