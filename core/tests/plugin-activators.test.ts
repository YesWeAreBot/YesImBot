import { describe, it, expect } from "vitest";

import { requireBotRole } from "../src/services/plugin/activators";
import type { ToolExecutionContext } from "../src/services/plugin/types";

describe("Plugin activators", () => {
  describe("requireBotRole", () => {
    it("accepts admin role from view.self.role", () => {
      const activator = requireBotRole("admin");
      const ctx = {
        platform: "onebot",
        channelId: "100",
        view: {
          self: { id: "bot", name: "YesImBot", role: "admin" },
          environment: {
            type: "guild",
            id: "100",
            name: "Test",
            platform: "onebot",
            channelId: "100",
          },
          entities: [],
          history: [],
        },
      } satisfies ToolExecutionContext;

      expect(activator.check(ctx)).toBe(true);
    });

    it("accepts owner role from view.self.role", () => {
      const activator = requireBotRole("owner");
      const ctx = {
        platform: "onebot",
        channelId: "100",
        view: {
          self: { id: "bot", name: "YesImBot", role: "owner" },
          environment: {
            type: "guild",
            id: "100",
            name: "Test",
            platform: "onebot",
            channelId: "100",
          },
          entities: [],
          history: [],
        },
      } satisfies ToolExecutionContext;

      expect(activator.check(ctx)).toBe(true);
    });
  });
});
