import { describe, expect, it, vi } from "vitest";

import {
  AgentSessionStore,
  projectSkillState,
  type AgentSessionState,
} from "../src/services/skill/session-store";
import type { LoadAttempt, SkillDefinition } from "../src/services/skill/types";
import { buildAgentRoundContext } from "../src/shared/context-factory";

function createSkill(name: string): SkillDefinition {
  return {
    name,
    description: `${name} description`,
    guidance: `${name} guidance`,
    rootDir: `/skills/${name}`,
    source: "plugin",
    allowedTools: [`${name}-tool`],
  };
}

describe("skill session persistence", () => {
  it("stores loaded skills by conversation scope", () => {
    const store = new AgentSessionStore({ logger: vi.fn(() => ({ info: vi.fn() })) } as never);
    const skill = createSkill("search");

    expect(store.loadSkill("discord", "c1", skill).status).toBe("loaded");
    expect(store.loadSkill("discord", "c1", skill).status).toBe("already_loaded");
    expect(store.getState("discord", "c1")).toEqual(
      expect.objectContaining({ loadedSkills: ["search"] }),
    );
    expect(store.getState("discord", "c2").loadedSkills).toEqual([]);
  });

  it("projects session state into round skill state", async () => {
    const loadHistory: LoadAttempt[] = [{ name: "search", status: "loaded", timestamp: 1 }];
    const state: AgentSessionState = {
      loadedSkills: ["search"],
      loadHistory,
    };
    const sessionStore = {
      getState: vi.fn(() => state),
    };
    const ctx = {
      logger: vi.fn(() => ({ warn: vi.fn() })),
      "yesimbot.session": sessionStore,
      "yesimbot.skill": {
        get: vi.fn(() => ({
          name: "search",
          description: "Search skill",
          guidance: "Search guidance",
          rootDir: "/skills/search",
          source: "plugin",
          allowedTools: ["search"],
        })),
      },
      "yesimbot.horizon": {
        buildView: vi.fn().mockResolvedValue({
          self: { id: "bot", name: "Athena" },
          environment: {
            type: "group",
            id: "c1",
            name: "General",
            platform: "discord",
            channelId: "c1",
          },
          entities: [],
          history: [],
        }),
      },
    } as never;

    const built = await buildAgentRoundContext(ctx, {
      platform: "discord",
      channelId: "c1",
      percept: {
        id: "wake-1",
        traceId: "trace-1",
        type: "mention",
        platform: "discord",
        channelId: "c1",
        timestamp: new Date("2026-03-15T00:00:00Z"),
      },
      toolCtx: {
        platform: "discord",
        channelId: "c1",
      },
    });

    expect(built.roundContext.skillState).toEqual(projectSkillState(state));
  });
});
