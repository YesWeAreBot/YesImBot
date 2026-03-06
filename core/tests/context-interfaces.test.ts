import { describe, it, expect } from "vitest";

import type { HorizonView } from "../src/services/horizon/types";
import type { ToolExecutionContext } from "../src/services/plugin/types";
import type { TraitSignal, ActiveSkill } from "../src/services/shared/types";

describe("Context Interface Extensions", () => {
  describe("HorizonView", () => {
    it("should accept traits field", () => {
      const traits: TraitSignal[] = [{ dimension: "mood", value: "happy", confidence: 0.8 }];
      const view: HorizonView = {
        self: { id: "bot1", name: "TestBot" },
        traits,
      };
      expect(view.traits).toBeDefined();
      expect(view.traits?.[0].dimension).toBe("mood");
    });

    it("should accept skills field", () => {
      const skills: ActiveSkill[] = [
        { name: "greeting", effects: ["friendly_tone"], metadata: {} },
      ];
      const view: HorizonView = {
        self: { id: "bot1", name: "TestBot" },
        skills,
      };
      expect(view.skills).toBeDefined();
      expect(view.skills?.[0].name).toBe("greeting");
    });

    it("should work without traits/skills (backward compatible)", () => {
      const view: HorizonView = {
        self: { id: "bot1", name: "TestBot" },
      };
      expect(view.traits).toBeUndefined();
      expect(view.skills).toBeUndefined();
    });
  });

  describe("ToolExecutionContext", () => {
    it("should accept view field", () => {
      const ctx: ToolExecutionContext = {
        platform: "discord",
        channelId: "123",
        view: { self: { id: "bot1", name: "TestBot" } },
      };
      expect(ctx.view).toBeDefined();
      expect(ctx.view?.self.id).toBe("bot1");
    });

    it("should accept traits field", () => {
      const ctx: ToolExecutionContext = {
        platform: "discord",
        channelId: "123",
        traits: [{ dimension: "scene", value: "casual", confidence: 0.9 }],
      };
      expect(ctx.traits).toBeDefined();
      expect(ctx.traits?.[0].dimension).toBe("scene");
    });

    it("should accept skills field", () => {
      const ctx: ToolExecutionContext = {
        platform: "discord",
        channelId: "123",
        skills: [{ name: "search", effects: ["web_access"] }],
      };
      expect(ctx.skills).toBeDefined();
      expect(ctx.skills?.[0].name).toBe("search");
    });

    it("should work without new fields (backward compatible)", () => {
      const ctx: ToolExecutionContext = {
        platform: "discord",
        channelId: "123",
      };
      expect(ctx.view).toBeUndefined();
      expect(ctx.traits).toBeUndefined();
      expect(ctx.skills).toBeUndefined();
    });
  });
});
