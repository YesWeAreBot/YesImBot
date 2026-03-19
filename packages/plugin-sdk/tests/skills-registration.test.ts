import { describe, expect, it, vi } from "vitest";

describe("plugin-sdk skills registration helpers", () => {
  it("registerSkill forwards to yesimbot.skill.register with service guard", async () => {
    const { registerSkill } = await import("../src/skills/index");
    const dispose = vi.fn();
    const register = vi.fn(() => dispose);
    const ctx = {
      "yesimbot.skill": {
        register,
      },
    };

    const def = {
      name: "search",
      description: "search",
      guidance: "guidance",
      rootDir: "/mock/search",
      source: "plugin" as const,
    };

    const returnedDispose = registerSkill(ctx as never, def);

    expect(register).toHaveBeenCalledWith(def);
    expect(returnedDispose).toBe(dispose);
  });

  it("registerSkillPack forwards to yesimbot.skill.registerDir", async () => {
    const { registerSkillPack } = await import("../src/skills/index");
    const dispose = vi.fn();
    const registerDir = vi.fn(() => [dispose]);
    const ctx = {
      "yesimbot.skill": {
        registerDir,
      },
    };

    const disposers = registerSkillPack(ctx as never, "/mock/skills");

    expect(registerDir).toHaveBeenCalledWith("/mock/skills", "plugin");
    expect(disposers).toEqual([dispose]);
  });
});
