import { describe, expect, it, vi } from "vitest";

import { CorePlugin } from "../src/services/plugin/builtin/core";
import { AgentSessionStore } from "../src/services/skill/session-store";

describe("loadSkill explicit activation", () => {
  it("returns already_loaded for duplicate requests", async () => {
    const sessionStore = new AgentSessionStore({
      logger: vi.fn(() => ({ info: vi.fn() })),
    } as never);
    const skill = {
      name: "search",
      description: "Search skill",
      guidance: "Use search when freshness matters.",
      allowedTools: ["search", "fetch"],
      resources: { "guide.txt": { path: "guide.txt" } },
      rootDir: "/tmp/search-skill",
      source: "plugin" as const,
    };
    const plugin = new CorePlugin({
      on: vi.fn(),
      logger: vi.fn(() => ({ info: vi.fn() })),
      "yesimbot.plugin": { registerPlugin: vi.fn(), unregisterPlugin: vi.fn() },
      "yesimbot.skill": { get: vi.fn(() => skill) },
      "yesimbot.session": sessionStore,
    } as never);

    const first = await plugin.loadSkillTool({ skillName: "search" }, {
      platform: "discord",
      channelId: "c1",
    } as never);
    const second = await plugin.loadSkillTool({ skillName: "search" }, {
      platform: "discord",
      channelId: "c1",
    } as never);

    expect(first.success).toBe(true);
    expect(first.content).toMatchObject({ status: "loaded", name: "search" });
    expect(second.success).toBe(true);
    expect(second.content).toMatchObject({ status: "already_loaded", name: "search" });
  });

  it("returns failure when skill is missing", async () => {
    const sessionStore = new AgentSessionStore({
      logger: vi.fn(() => ({ info: vi.fn() })),
    } as never);
    const plugin = new CorePlugin({
      on: vi.fn(),
      logger: vi.fn(() => ({ info: vi.fn() })),
      "yesimbot.plugin": { registerPlugin: vi.fn(), unregisterPlugin: vi.fn() },
      "yesimbot.skill": { get: vi.fn(() => undefined) },
      "yesimbot.session": sessionStore,
    } as never);

    const result = await plugin.loadSkillTool({ skillName: "missing" }, {
      platform: "discord",
      channelId: "c1",
    } as never);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Skill not found: missing");
  });
});
