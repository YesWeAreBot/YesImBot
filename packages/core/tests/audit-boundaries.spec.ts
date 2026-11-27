import { readFileSync } from "node:fs";

import { expect, it, vi } from "vitest";

import { personSnapshotGuard } from "../../person-memory/src/snapshot-guard";
import { withReplyTurn } from "../src/agent/reply-turn";
import QManagerExtension from "../src/extension/builtin/qmanager";
import { processParams } from "../src/extension/parameter-view";
import { MustacheRenderer } from "../src/prompt/renderer";
import { PromptService } from "../src/prompt/service";
import { InteractionManager } from "../src/world/interaction-manager";
import { WorldStateService } from "../src/world/service";

const logger = { error() {}, warn() {}, info() {}, debug() {} };
function management(authorized = true) {
    const ctx: any = { filter: () => true, logger };
    const session: any = {
        platform: "onebot",
        selfId: "bot",
        channelId: "room",
        guildId: "guild",
        userId: "admin",
        messageId: "trigger",
        isDirect: false,
        bot: { muteGuildMember: vi.fn(), kickGuildMember: vi.fn(), deleteMessage: vi.fn(), getMessage: vi.fn() },
    };
    const extension: any = Object.assign(Object.create(QManagerExtension.prototype), {
        ctx,
        config: {
            policies: authorized ? [{ platform: "onebot", selfId: "bot", guildId: "guild", userIds: ["admin"], actions: ["ban", "kick", "delmsg"] }] : [],
        },
    });
    return { extension, session, ctx };
}
it("requires explicit actor, action and current-group authorization before moderation", async () => {
    const f = management(false);
    expect((await f.extension.ban({ session: f.session, user_id: "u", duration: 1 })).status).toBe("error");
    expect(f.session.bot.muteGuildMember).not.toHaveBeenCalled();
    const g = management();
    expect((await g.extension.ban({ session: g.session, user_id: "u", duration: 2 })).status).toBe("success");
    expect(g.session.bot.muteGuildMember).toHaveBeenCalledWith("guild", "u", 120000);
    g.session.userId = "untrusted";
    expect((await g.extension.kick({ session: g.session, user_id: "u" })).status).toBe("error");
    expect(g.session.bot.kickGuildMember).not.toHaveBeenCalled();
});
it.each([NaN, Infinity, -1, 11, 1.5, "2", "", 0])("rejects invalid or separately unauthorized mute duration %s", async (duration) => {
    const f = management();
    expect((await f.extension.ban({ session: f.session, user_id: "u", duration })).status).toBe("error");
    expect(f.session.bot.muteGuildMember).not.toHaveBeenCalled();
});
it("rejects cross-group, filtered and stale moderation without side effects", async () => {
    const f = management();
    expect((await f.extension.kick({ session: f.session, user_id: "u", guild_id: "elsewhere" })).status).toBe("error");
    f.ctx.filter = () => false;
    expect((await f.extension.kick({ session: f.session, user_id: "u" })).status).toBe("error");
    f.ctx.filter = () => true;
    const result = await withReplyTurn(
        () => false,
        () => f.extension.kick({ session: f.session, user_id: "u" }),
    );
    expect(result.status).toBe("error");
    expect(f.session.bot.kickGuildMember).not.toHaveBeenCalled();
});
it("checks globally addressed message ownership before deletion", async () => {
    const f = management();
    f.session.bot.getMessage.mockResolvedValue({ id: "other", channel: { id: "elsewhere" } });
    expect((await f.extension.delmsg({ session: f.session, message_id: "other" })).status).toBe("error");
    expect(f.session.bot.deleteMessage).not.toHaveBeenCalled();
    f.session.bot.getMessage.mockResolvedValue({ id: "other", channel: { id: "room" }, guild: { id: "guild" } });
    expect((await f.extension.delmsg({ session: f.session, message_id: "other" })).status).toBe("success");
    expect(f.session.bot.deleteMessage).toHaveBeenCalledWith("room", "other");
});
const template = readFileSync(new URL("../resources/templates/l1_history_item.mustache", import.meta.url), "utf8");
it.each([false, 0, "", null, [], [0, false, { x: "value" }]].map((value) => [value]))("renders tool result %j once without losing its JSON shape", (result) => {
    const output = new MustacheRenderer().render(template, { type: "agent_observation", is_agent_observation: true, result });
    expect(output).toContain("<result>" + JSON.stringify(result) + "</result>");
    expect(output.split("<result>")).toHaveLength(2);
});
it("keeps snapshot metadata through history, but renders only the filtered result after invalidation", async () => {
    let revision = 1;
    const guard = personSnapshotGuard({ on() {} }, async () => revision, false);
    const wrapped = guard({ name: "person_memory", execute: async () => ({ status: "success", result: { text: "PRIVATE_OLD_RESULT" } }) });
    const result = await wrapped.execute({ session: {}, action: "read" });
    const log = JSON.parse(
        JSON.stringify({
            type: "agent_observation",
            id: "o",
            actionId: "a",
            turnId: "t",
            timestamp: new Date().toISOString(),
            function: "person_memory",
            ...result,
        }),
    );
    const item = (InteractionManager.prototype as any).logEntryToHistoryItem(log);
    expect(item.metadata.personMemorySnapshot).toBe(result.metadata.personMemorySnapshot);
    const state = { l1_working_memory: { new_events: [item], processed_events: [] } };
    await guard.project({}, state);
    expect(state.l1_working_memory.new_events[0].result.text).toBe("PRIVATE_OLD_RESULT");
    revision++;
    await guard.project({}, state);
    const output = new MustacheRenderer().render(template, { ...state.l1_working_memory.new_events[0], is_agent_observation: true });
    expect(output).not.toContain("PRIVATE_OLD_RESULT");
    expect(output).toContain("快照已过期");
});
it("copies prompt write paths without mutating reused caller objects", () => {
    const original = { nested: { keep: "same", value: "original" } };
    const scope = { ...original };
    (PromptService.prototype as any).setNestedProperty(scope, "nested.value", "rendered");
    expect(original.nested.value).toBe("original");
    expect(scope.nested).toEqual({ keep: "same", value: "rendered" });
    expect(() => (PromptService.prototype as any).setNestedProperty(scope, "__proto__.polluted", true)).toThrow("Unsafe");
});
it("uses one recursive parameter view for primitive, nested and object arrays", () => {
    const input: any = {
        values: { type: "array", items: { type: "array", items: { type: "boolean", default: false, enum: [false, true] } } },
        object: { type: "object", properties: { count: { type: "number", default: 0 } } },
    };
    const before = structuredClone(input);
    const view = processParams(input);
    expect(view[0].items[0].items[0]).toMatchObject({ type: "boolean", default: false, enum: [false, true], key: "item" });
    expect(view[1].properties[0].default).toBe(0);
    expect(input).toEqual(before);
});

it("does not run global history retention without explicit administrator opt-in", async () => {
    const remove = vi.fn();
    const service: any = Object.assign(Object.create(WorldStateService.prototype), {
        config: { dataRetentionDays: 1 },
        ctx: { database: { remove } },
        logger,
    });
    await service.clear();
    expect(remove).not.toHaveBeenCalled();
});
