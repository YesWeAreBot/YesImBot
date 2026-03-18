import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(),
}));

vi.mock("gray-matter", () => ({
  default: vi.fn(),
}));

import { readFileSync, readdirSync } from "node:fs";

import matter from "gray-matter";

import { loadSkillsFromDir } from "../src/services/skill/loader";

describe("Skill fragment metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes deprecated injection_point to prompt_fragment.section", () => {
    vi.mocked(readdirSync).mockReturnValue([
      { name: "test-skill", isDirectory: () => true },
    ] as never);
    vi.mocked(readFileSync).mockReturnValue("skill content" as never);
    vi.mocked(matter).mockReturnValue({
      data: {
        name: "test-skill",
        injection_point: "policy",
      },
      content: "Test prompt content",
    } as never);

    const skills = loadSkillsFromDir("/mock/dir");

    expect(skills[0].promptFragment?.section).toBe("situation");
  });

  it("normalizes deprecated style_injection_point to style_fragment.section", () => {
    vi.mocked(readdirSync).mockReturnValue([
      { name: "test-skill", isDirectory: () => true },
    ] as never);
    vi.mocked(readFileSync).mockReturnValue("skill content" as never);
    vi.mocked(matter).mockReturnValue({
      data: {
        name: "test-skill",
        style_injection_point: "policy",
      },
      content: "Test prompt content",
    } as never);

    const skills = loadSkillsFromDir("/mock/dir");

    expect(skills[0].styleFragment?.section).toBe("identity");
  });

  it("applies prompt fragment defaults: section=situation, priority=400, stability=dynamic, cacheable=false", () => {
    vi.mocked(readdirSync).mockReturnValue([
      { name: "test-skill", isDirectory: () => true },
    ] as never);
    vi.mocked(readFileSync).mockReturnValue("skill content" as never);
    vi.mocked(matter).mockReturnValue({
      data: { name: "test-skill" },
      content: "Test prompt content",
    } as never);

    const skills = loadSkillsFromDir("/mock/dir");

    expect(skills[0].promptFragment).toEqual({
      section: "situation",
      stability: "dynamic",
      priority: 400,
      cacheable: false,
    });
  });

  it("applies style fragment defaults: section=identity, priority=650, stability=dynamic, cacheable=false", () => {
    vi.mocked(readdirSync).mockReturnValue([
      { name: "test-skill", isDirectory: () => true },
    ] as never);
    vi.mocked(readFileSync).mockReturnValue("skill content" as never);
    vi.mocked(matter).mockReturnValue({
      data: { name: "test-skill" },
      content: "Test prompt content",
    } as never);

    const skills = loadSkillsFromDir("/mock/dir");

    expect(skills[0].styleFragment).toEqual({
      section: "identity",
      stability: "dynamic",
      priority: 650,
      cacheable: false,
    });
  });
});
