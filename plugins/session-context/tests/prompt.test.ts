import { describe, expect, it } from "vitest";

import { buildSessionContextPrompt } from "../src/prompt";

describe("session-context prompt", () => {
  it("describes platform + channelId as preferred locator", () => {
    const prompt = buildSessionContextPrompt({
      isolation: false,
      currentChannel: {
        platform: "onebot",
        channelId: "10001",
        channelKey: "abc123def4567890",
      },
      defaultLimit: 20,
      maxLimit: 100,
    });

    expect(prompt).toContain("首选输入是 `platform + channelId`");
    expect(prompt).toContain("不知道 `channelKey` 不是阻塞");
    expect(prompt).toContain("find_channels");
    expect(prompt).toContain("read_session_window");
  });

  it("spells out isolation restrictions", () => {
    const prompt = buildSessionContextPrompt({
      isolation: true,
      currentChannel: {
        platform: "discord",
        channelId: "guild-1",
        channelKey: "def456abc1237890",
      },
      defaultLimit: 20,
      maxLimit: 100,
    });

    expect(prompt).toContain("隔离模式：只能访问当前频道");
    expect(prompt).not.toContain("先用 `list_sessions` 做全量枚举");
  });
});
