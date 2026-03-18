import { describe, it, expect } from "vitest";

import type { HorizonView } from "../src/services/horizon/types";
import type { ToolExecutionContext } from "../src/services/plugin/types";

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
    it("should expose canonical context fields", () => {
      const ctx: ToolExecutionContext = {
        platform: "discord",
        channelId: "123",
        roundContext: {} as ToolExecutionContext["roundContext"],
        scenario: {} as ToolExecutionContext["scenario"],
        capabilities: {} as ToolExecutionContext["capabilities"],
      };
      expect(ctx.roundContext).toBeDefined();
      expect(ctx.scenario).toBeDefined();
      expect(ctx.capabilities).toBeDefined();
    });

    it("should keep canonical fields without legacy assumptions", () => {
      const ctx: ToolExecutionContext = {
        platform: "discord",
        channelId: "123",
        scenario: {} as ToolExecutionContext["scenario"],
      };
      expect(ctx.platform).toBe("discord");
      expect(ctx.scenario).toBeDefined();
    });

    it("should work without new fields (backward compatible)", () => {
      const ctx: ToolExecutionContext = {
        platform: "discord",
        channelId: "123",
      };
      expect(ctx.scenario).toBeUndefined();
    });
  });
});
