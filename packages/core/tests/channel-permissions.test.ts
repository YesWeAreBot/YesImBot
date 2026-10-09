import { expect, it } from "bun:test";

import { WorldStateService } from "../src/services/worldstate/service";

const group = { platform: "onebot", channelId: "channel", guildId: "guild", userId: "user", isDirect: false };
const direct = { ...group, channelId: "private:user", guildId: undefined, isDirect: true };
const rule = (type: string, id: string, platform = "onebot") => ({ platform, type, id });
const cases = [
    ["guild wildcard allows group", rule("guild", "*"), group, true],
    ["guild wildcard rejects private", rule("guild", "*"), direct, false],
    ["guild channel ID allows group", rule("guild", "channel"), group, true],
    ["guild channel ID rejects private even with matching ID", rule("guild", "private:user"), direct, false],
    ["guild guild ID allows group", rule("guild", "guild"), group, true],
    ["guild guild ID rejects private even with guild metadata", rule("guild", "guild"), { ...direct, guildId: "guild" }, false],
    ["guild rule does not match sender user ID", rule("guild", "user"), group, false],
    ["private wildcard allows private", rule("private", "*"), direct, true],
    ["private wildcard rejects group", rule("private", "*"), group, false],
    ["private channel ID allows private", rule("private", "private:user"), direct, true],
    ["private channel ID rejects group even with matching ID", rule("private", "channel"), group, false],
    ["private user ID allows private", rule("private", "user"), direct, true],
    ["private user ID rejects group", rule("private", "user"), group, false],
    ["private guild metadata retains existing ID matching", rule("private", "guild"), { ...direct, guildId: "guild" }, true],
    ["guild unmatched ID rejects group", rule("guild", "other"), group, false],
    ["private unmatched ID rejects private", rule("private", "other"), direct, false],
    ["guild wildcard rejects a different platform", rule("guild", "*", "qq"), group, false],
    ["private wildcard rejects a different platform", rule("private", "*", "qq"), direct, false],
    ["unknown rule type rejects group", rule("unknown", "*"), group, false],
    ["unknown rule type rejects private", rule("unknown", "*"), direct, false],
] as const;

for (const [name, permission, session, allowed] of cases) {
    it(name, () => {
        const service = Object.create(WorldStateService.prototype);
        service.config = { allowedChannels: [permission] };
        expect(service.isChannelAllowed(session as any)).toBe(allowed);
    });
}

it("allows a matching rule among multiple rules and rejects an empty list", () => {
    const service = Object.create(WorldStateService.prototype);
    service.config = { allowedChannels: [rule("guild", "*"), rule("private", "user")] };
    expect(service.isChannelAllowed(direct as any)).toBe(true);
    service.config = { allowedChannels: [] };
    expect(service.isChannelAllowed(group as any)).toBe(false);
    expect(service.isChannelAllowed(direct as any)).toBe(false);
});
