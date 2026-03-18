import { describe, expect, it, vi } from "vitest";

import { CorePlugin } from "../src/services/plugin/builtin/core";
import { AgentSessionStore } from "../src/services/skill/session-store";

describe("loadSkill tool payload", () => {
  it("loadSkill returns guidance, enabled tools, and resources", async () => {
    const sessionStore = new AgentSessionStore({
      logger: vi.fn(() => ({ info: vi.fn() })),
    } as never);
    const plugin = new CorePlugin({
      on: vi.fn(),
      logger: vi.fn(() => ({ info: vi.fn() })),
      "yesimbot.plugin": { registerPlugin: vi.fn(), unregisterPlugin: vi.fn() },
      "yesimbot.skill": {
        get: vi.fn(() => ({
          name: "search",
          description: "Search skill",
          guidance: "Use search when freshness matters.",
          allowedTools: ["search", "fetch"],
          resources: { "guide.txt": { path: "guide.txt", description: "Search usage guide" } },
          rootDir: "/tmp/search-skill",
          source: "plugin",
        })),
      },
      "yesimbot.session": sessionStore,
    } as never);

    const result = await plugin.loadSkillTool({ skillName: "search" }, {
      platform: "discord",
      channelId: "c1",
    } as never);

    if (!result.ok) {
      throw new Error(result.error ?? "loadSkill failed unexpectedly");
    }

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: "loaded",
      name: "search",
      description: "Search skill",
      enabledTools: ["search", "fetch"],
      guidance: "Use search when freshness matters.",
    });
    expect(result.data).toMatchObject({
      resources: [{ storeKey: "guide.txt", path: "guide.txt", description: "Search usage guide" }],
    });
  });
});
