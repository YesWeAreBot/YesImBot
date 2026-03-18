import { describe, it, expect } from "vitest";

import type { HorizonView } from "../src/services/horizon/types";
import type { ToolExecutionContext } from "../src/services/plugin/types";
import type { TraitSignal, ActiveSkill } from "../src/shared/types";

describe("Context Interface Extensions", () => {
  describe("HorizonView", () => {
    it("should require all fields (self, environment, entities, history)", () => {
      const view: HorizonView = {
        self: { id: "bot1", name: "TestBot" },
        environment: {
          type: "guild",
          id: "ch1",
          name: "General",
          platform: "discord",
          channelId: "ch1",
        },
        entities: [{ id: "u1", type: "user", name: "Alice" }],
        history: [],
      };
      expect(view.self.id).toBe("bot1");
      expect(view.environment.platform).toBe("discord");
      expect(view.entities).toHaveLength(1);
      expect(view.history).toHaveLength(0);
    });

    it("should not have traits or skills fields", () => {
      const view: HorizonView = {
        self: { id: "bot1", name: "TestBot" },
        environment: {
          type: "guild",
          id: "ch1",
          name: "General",
          platform: "discord",
          channelId: "ch1",
        },
        entities: [],
        history: [],
      };
      expect("traits" in view).toBe(false);
      expect("skills" in view).toBe(false);
    });

    it("should work with minimal valid construction", () => {
      const view: HorizonView = {
        self: { id: "", name: "" },
        environment: {
          type: "unknown",
          id: "",
          name: "",
          platform: "unknown",
          channelId: "",
        },
        entities: [],
        history: [],
      };
      expect(view).toBeDefined();
      expect(view.entities).toEqual([]);
      expect(view.history).toEqual([]);
    });
  });

  describe("ToolExecutionContext", () => {
    it("should accept view field", () => {
      const ctx: ToolExecutionContext = {
        platform: "discord",
        channelId: "123",
        view: {
          self: { id: "bot1", name: "TestBot" },
          environment: {
            type: "guild",
            id: "ch1",
            name: "General",
            platform: "discord",
            channelId: "ch1",
          },
          entities: [],
          history: [],
        },
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
