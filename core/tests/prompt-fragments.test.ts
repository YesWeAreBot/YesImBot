import type { Context } from "koishi";
import { describe, expect, it, vi } from "vitest";

import { PromptService } from "../src/services/prompt/service";
import type { PromptFragment } from "../src/services/prompt/types";

type FragmentProvider = (
  scope: Record<string, unknown>,
) => PromptFragment[] | Promise<PromptFragment[]>;

function createPromptService(): PromptService {
  const ctx = {
    logger: vi.fn(() => ({
      level: 2,
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    on: vi.fn(),
  } as unknown as Context;

  return new PromptService(ctx, {});
}

describe("prompt fragments", () => {
  it("renders identity -> policy -> memory -> situation and omits empty sections", async () => {
    const service = createPromptService();

    (
      service as unknown as {
        registerFragmentSource: (name: string, provider: FragmentProvider) => void;
      }
    ).registerFragmentSource("base", () => [
      {
        id: "identity.base",
        section: "identity",
        source: "role",
        priority: 10,
        stability: "stable",
        cacheable: true,
        content: "identity content",
      },
      {
        id: "situation.base",
        section: "situation",
        source: "scenario",
        priority: 10,
        stability: "dynamic",
        content: "situation content",
      },
    ]);

    const sections = await service.render("system", {});
    expect(sections.map((section) => section.name)).toEqual(["identity", "situation"]);
  });

  it("sorts by priority, source precedence, then stable id", async () => {
    const service = createPromptService();

    (
      service as unknown as {
        registerFragmentSource: (name: string, provider: FragmentProvider) => void;
      }
    ).registerFragmentSource("ordering", () => [
      {
        id: "policy.z-low",
        section: "policy",
        source: "tooling",
        priority: 1,
        stability: "stable",
        cacheable: true,
        content: "tooling low",
      },
      {
        id: "policy.b-high-memory",
        section: "policy",
        source: "memory",
        priority: 20,
        stability: "stable",
        cacheable: true,
        content: "memory high",
      },
      {
        id: "policy.a-high-role",
        section: "policy",
        source: "role",
        priority: 20,
        stability: "stable",
        cacheable: true,
        content: "role high",
      },
    ]);

    const sections = await service.render("system", {});
    expect(sections.find((section) => section.name === "policy")?.content).toContain(
      "role high\n\nmemory high\n\ntooling low",
    );
  });

  it("throws for duplicate fragment id and illegal dynamic cacheable combinations", async () => {
    const service = createPromptService();

    (
      service as unknown as {
        registerFragmentSource: (name: string, provider: FragmentProvider) => void;
      }
    ).registerFragmentSource("invalid", () => [
      {
        id: "dup.id",
        section: "identity",
        source: "role",
        priority: 0,
        stability: "stable",
        cacheable: true,
        content: "first",
      },
      {
        id: "dup.id",
        section: "memory",
        source: "memory",
        priority: 0,
        stability: "stable",
        cacheable: true,
        content: "second",
      },
    ]);

    await expect(service.render("system", {})).rejects.toThrow(/duplicate fragment id/i);

    const dynamicCacheable = createPromptService();
    (
      dynamicCacheable as unknown as {
        registerFragmentSource: (name: string, provider: FragmentProvider) => void;
      }
    ).registerFragmentSource("dynamic", () => [
      {
        id: "dynamic.cacheable",
        section: "situation",
        source: "scenario",
        priority: 0,
        stability: "dynamic",
        cacheable: true,
        content: "bad combo",
      },
    ]);

    await expect(dynamicCacheable.render("system", {})).rejects.toThrow(/dynamic.*cacheable/i);
  });
});
