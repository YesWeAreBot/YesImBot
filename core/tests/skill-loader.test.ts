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

describe("skill loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses minimal standardized skill metadata", () => {
    vi.mocked(readdirSync)
      .mockReturnValueOnce([{ name: "image-gen", isDirectory: () => true }] as never)
      .mockReturnValueOnce([] as never);
    vi.mocked(readFileSync).mockReturnValue("skill content" as never);
    vi.mocked(matter).mockReturnValue({
      data: {
        name: "image-gen",
        description: "Image tools",
        allowed_tools: ["image-generate", "image-edit"],
      },
      content: "Guidance body",
    } as never);

    const skills = loadSkillsFromDir("/mock/skills");

    expect(skills).toEqual([
      expect.objectContaining({
        name: "image-gen",
        description: "Image tools",
        guidance: "Guidance body",
        allowedTools: ["image-generate", "image-edit"],
        rootDir: "/mock/skills/image-gen",
      }),
    ]);
  });

  it("preserves explicit resource mappings when declared", () => {
    vi.mocked(readdirSync).mockReturnValue([{ name: "search", isDirectory: () => true }] as never);
    vi.mocked(readFileSync).mockReturnValue("skill content" as never);
    vi.mocked(matter).mockReturnValue({
      data: {
        name: "search",
        description: "Search skill",
        resources: {
          "examples/basic.md": {
            path: "resources/basic.md",
            description: "Basic search examples",
          },
        },
      },
      content: "Use search carefully",
    } as never);

    const skills = loadSkillsFromDir("/mock/skills");

    expect(skills[0]?.resources).toEqual({
      "examples/basic.md": {
        path: "resources/basic.md",
        description: "Basic search examples",
      },
    });
  });
});
