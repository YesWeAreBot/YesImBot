import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { requireBotRole, requirePlatform, requireSession } from "../src/services/plugin/activators";
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

  describe("requireSession", () => {
    it("prefers capabilities.platform.session when available", () => {
      const activator = requireSession();
      const ctx = {
        platform: "onebot",
        channelId: "100",
        capabilities: {
          core: {},
          extended: {
            "platform.session": { status: "available" as const, source: "resolver" },
          },
        },
      } satisfies ToolExecutionContext;

      expect(activator.check(ctx)).toBe(true);
    });

    it("falls back to raw session when capabilities are absent", () => {
      const activator = requireSession();
      const ctx = {
        platform: "onebot",
        channelId: "100",
        session: { platform: "onebot", channelId: "100" },
      } as unknown as ToolExecutionContext;

      expect(activator.check(ctx)).toBe(true);
    });
  });

  describe("requirePlatform", () => {
    it("prefers scenario platform", () => {
      const activator = requirePlatform("onebot");
      const ctx = {
        platform: "discord",
        channelId: "100",
        scenario: {
          raw: {
            environment: {
              platform: "onebot",
            },
          },
        },
      } as unknown as ToolExecutionContext;

      expect(activator.check(ctx)).toBe(true);
    });

    it("falls back to session platform when scenario is absent", () => {
      const activator = requirePlatform("onebot");
      const ctx = {
        platform: "onebot",
        channelId: "100",
        session: { platform: "onebot", channelId: "100" },
      } as unknown as ToolExecutionContext;

      expect(activator.check(ctx)).toBe(true);
    });
  });

  describe("builtin tool capability declarations", () => {
    const coreBuiltin = readFileSync(
      path.resolve(__dirname, "../src/services/plugin/builtin/core.ts"),
      "utf8",
    );
    const onebotBuiltin = readFileSync(
      path.resolve(__dirname, "../src/services/plugin/builtin/onebot/index.ts"),
      "utf8",
    );

    it("send_message requires message.send", () => {
      expect(coreBuiltin).toContain('requiredCapabilities: ["message.send"]');
      expect(coreBuiltin).toContain('onCapabilityMissing: "remove"');
    });

    it("onebot actions declare required capabilities", () => {
      expect(onebotBuiltin).toContain('requiredCapabilities: ["social.reaction"]');
      expect(onebotBuiltin).toContain('requiredCapabilities: ["social.essence"]');
      expect(onebotBuiltin).toContain('requiredCapabilities: ["message.delete"]');
      expect(onebotBuiltin).toContain('requiredCapabilities: ["member.moderate"]');
    });

    it("onebot tools declare required capabilities", () => {
      expect(onebotBuiltin).toContain('requiredCapabilities: ["platform.session"]');
      expect(onebotBuiltin).toContain('onCapabilityMissing: "remove"');
    });
  });
});
