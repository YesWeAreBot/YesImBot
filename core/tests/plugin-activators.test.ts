import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";
describe("Plugin capability declarations", () => {
  describe("builtin tool capability declarations", () => {
    const coreBuiltin = readFileSync(
      path.resolve(__dirname, "../src/services/plugin/builtin/core.ts"),
      "utf8",
    );
    const onebotBuiltin = readFileSync(
      path.resolve(__dirname, "../src/services/plugin/builtin/onebot/index.ts"),
      "utf8",
    );

    it("send_message requires platform.session", () => {
      expect(coreBuiltin).toContain('requiredCapabilities: ["platform.session"]');
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

    it("builtin tools no longer use activators", () => {
      expect(coreBuiltin).not.toContain("activators:");
      expect(onebotBuiltin).not.toContain("activators:");
      expect(coreBuiltin).not.toContain("requireSession");
      expect(onebotBuiltin).not.toContain("requireSession");
      expect(onebotBuiltin).not.toContain("requirePlatform");
      expect(onebotBuiltin).not.toContain("requireBotRole");
    });
  });
});
