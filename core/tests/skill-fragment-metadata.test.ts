import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
  class Service {
    ctx: Record<string, unknown>;
    config: unknown;
    logger: Record<string, unknown>;

    constructor(ctx: Record<string, unknown>, _name: string, _immediate?: boolean) {
      this.ctx = ctx;
      this.logger = (ctx.logger as (name: string) => Record<string, unknown>)("mock-service");
      this.config = {};
    }
  }

  return {
    Context: class {},
    Schema: {
      array: vi.fn(() => ({ default: vi.fn() })),
      path: vi.fn(() => ({ default: vi.fn() })),
      number: vi.fn(() => ({ default: vi.fn() })),
      object: vi.fn(() => ({ description: vi.fn() })),
    },
    Service,
  };
});

import { loadSkillsFromDir } from "../src/services/skill/loader";
import { SkillRegistry } from "../src/services/skill/service";

function createRegistry() {
  const ctx: Record<string, unknown> = {
    logger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    on: vi.fn(),
  };

  return new SkillRegistry(ctx as never, {
    confidenceThreshold: 0.3,
    stickyDefaultTimeout: 3,
    skillPaths: [],
  });
}

describe("Skill fragment metadata migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes deprecated alias injection_point/style_injection_point into explicit sections", () => {
    const root = mkdtempSync(join(tmpdir(), "athena-skill-"));
    const skillDir = join(root, "alias-skill");
    mkdirSync(skillDir);

    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: alias-skill
lifecycle: per-turn
injection_point: instructions # deprecated alias
style_injection_point: instructions # deprecated alias
effects:
  style:
    content: "Use strong policy language"
---
Prompt content from deprecated alias config.
`,
      "utf-8",
    );

    const loaded = loadSkillsFromDir(root);
    expect(loaded).toHaveLength(1);

    expect(loaded[0]).toMatchObject({
      name: "alias-skill",
      promptFragment: {
        section: "policy",
      },
      styleFragment: {
        section: "policy",
      },
    });
  });

  it("defaults skill prompt/style outputs to situation and identity metadata", () => {
    const registry = createRegistry();
    registry.register({
      name: "default-skill",
      lifecycle: "per-turn",
      source: "plugin",
      activate: () => true,
      effects: {
        prompt: "Situation-specific hint",
        style: {
          content: "Stable identity style hint",
        },
      },
    } as never);

    const resolved = registry.resolve([], { platform: "discord", channelId: "chan-1" });

    expect(resolved.promptFragments).toHaveLength(1);
    expect(resolved.promptFragments[0]).toMatchObject({
      skillName: "default-skill",
      section: "situation",
      stability: "dynamic",
      priority: 400,
      cacheable: false,
    });

    expect(resolved.styleFragment).toMatchObject({
      section: "identity",
      stability: "dynamic",
      priority: 650,
      cacheable: false,
    });
  });
});
