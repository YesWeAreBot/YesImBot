import { Universal } from "koishi";
import { expect, it } from "vitest";

import { prepareDelivery } from "../src/policy";
import type { DurableTask } from "../src/store";

const task = { platform: "onebot", selfId: "bot", channelId: "g", guildId: "guild", requester: "u", isDirect: false } as DurableTask;
function fixture() {
    const bot = {
        platform: "onebot",
        selfId: "bot",
        status: Universal.Status.ONLINE,
        getChannel: async () => ({ id: "g", type: Universal.Channel.Type.TEXT }),
        session: (event: any) => ({ ...event, cid: "onebot:g", channelId: event.channel.id, isDirect: false }),
    };
    const world = { stimulusOwnerId: "current-owner", isChannelAllowed: () => true, isBotMuted: () => false };
    const runtime = { bots: [bot], filter: () => true, world, rules: async () => [] as any[] };
    return { bot, world, runtime };
}
it("restores the authenticated target and uses the current world owner", async () => {
    const { runtime } = fixture();
    const result = await prepareDelivery(runtime as any, task, "current-owner");
    expect(result).toMatchObject({ ownerId: "current-owner", session: { channelId: "g", user: { id: "u" } } });
});
for (const denied of ["owner", "bot", "offline", "channel", "filter", "allowlist", "mute", "pause"])
    it(`refuses a restored reminder with invalid ${denied}`, async () => {
        const { runtime, bot, world } = fixture();
        if (denied === "owner") world.stimulusOwnerId = "replacement";
        if (denied === "bot") bot.selfId = "other";
        if (denied === "offline") bot.status = Universal.Status.OFFLINE;
        if (denied === "channel")
            bot.getChannel = async () => {
                throw new Error("not a member");
            };
        if (denied === "filter") runtime.filter = () => false;
        if (denied === "allowlist") world.isChannelAllowed = () => false;
        if (denied === "mute") world.isBotMuted = () => true;
        if (denied === "pause") runtime.rules = async () => [{ blocked: ["scheduled"], expiresAt: null }];
        expect(await prepareDelivery(runtime as any, task, "current-owner")).toHaveProperty("error");
    });

it("checks the parent-qualified Telegram topic mute state when restoring a reminder", async () => {
    const f = fixture();
    f.bot.platform = "telegram";
    f.bot.getChannel = async () => ({ id: "7", type: Universal.Channel.Type.TEXT });
    f.bot.session = (event: any) => ({ ...event, channelId: event.channel.id, guildId: event.guild.id, isDirect: false, selfId: "bot", cid: "telegram:7" });
    const checked: string[] = [];
    f.world.isBotMuted = (cid: string) => {
        checked.push(cid);
        return false;
    };
    const input = { ...task, platform: "telegram", channelId: "7", guildId: "-1001" };
    expect(await prepareDelivery(f.runtime as any, input, "current-owner")).not.toHaveProperty("error");
    expect(checked).toEqual(Array.from({ length: 2 }, () => 'telegram:telegram-topic:["-1001","7"]'));
});
