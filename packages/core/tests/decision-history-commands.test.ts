import { expect, it } from "bun:test";

import { registerDecisionCommands } from "../src/agent/decision-commands";

it("limits history queries to the invoking session and validates time bounds", async () => {
    const handlers = new Map<string, any>();
    const authorities = new Map<string, number>();
    const ctx: any = {
        command(name: string, _: string, config: any) {
            authorities.set(name, config.authority);
            const command = {
                option() {
                    return command;
                },
                action(fn: any) {
                    handlers.set(name, fn);
                    return command;
                },
            };
            return command;
        },
    };
    const session: any = { platform: "qq", selfId: "bot", channelId: "g" };
    const calls: any[] = [];
    registerDecisionCommands(
        ctx,
        () => "current",
        async (value, filter) => {
            calls.push([value, filter]);
            return "saved events";
        },
    );
    const handler = handlers.get("chat.decisions [limit:natural]");
    expect(typeof handler).toBe("function");
    expect(authorities.get("chat.decisions [limit:natural]")).toBe(3);
    expect(await handler({ session, options: {} }, undefined)).toBe("saved events");
    expect(calls[0]).toEqual([session, { limit: 10, from: undefined, to: undefined }]);
    expect(await handler({ session, options: { from: "bad" } }, 10)).toContain("时间");
    expect(await handler({ session, options: {} }, 101)).toContain("1 到 100");
    expect(calls).toHaveLength(1);
});
