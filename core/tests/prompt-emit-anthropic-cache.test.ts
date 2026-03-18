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

describe("prompt emit anthropic cache", () => {
  it("derives stable/dynamic blocks and stableSignature from canonical order", async () => {
    const service = createPromptService();

    (
      service as unknown as {
        registerFragmentSource: (name: string, provider: FragmentProvider) => void;
      }
    ).registerFragmentSource("canonical", () => [
      {
        id: "identity.base",
        section: "identity",
        source: "role",
        priority: 100,
        stability: "stable",
        cacheable: true,
        content: "identity",
      },
      {
        id: "policy.tooling.protocol",
        section: "policy",
        source: "tooling",
        priority: 500,
        stability: "stable",
        cacheable: true,
        content: "tooling.protocol",
      },
      {
        id: "tooling.available",
        section: "situation",
        source: "tooling",
        priority: 520,
        stability: "dynamic",
        cacheable: false,
        content: "tooling.available",
      },
    ]);

    const emitted = await (
      service as unknown as {
        emitPromptBlocks: (
          template: string,
          scope: Record<string, unknown>,
          options?: { providerType?: string },
        ) => Promise<{
          sections: Array<{ name: string; content: string }>;
          stableBlock: string;
          dynamicBlock: string;
          stableSignature: string;
        }>;
      }
    ).emitPromptBlocks("system", {}, { providerType: "anthropic" });

    expect(emitted.sections.map((section) => section.name)).toEqual([
      "identity",
      "policy",
      "situation",
    ]);
    expect(emitted.stableBlock).toContain("<identity>");
    expect(emitted.stableBlock).toContain("<policy>");
    expect(emitted.dynamicBlock).toContain("<situation>");
    expect(emitted.dynamicBlock).toContain("tooling.available");
    expect(emitted.stableSignature.length).toBeGreaterThan(0);
  });

  it("does not reorder canonical sections when splitting anthropic cache blocks", async () => {
    const service = createPromptService();

    (
      service as unknown as {
        registerFragmentSource: (name: string, provider: FragmentProvider) => void;
      }
    ).registerFragmentSource("order", () => [
      {
        id: "identity.base",
        section: "identity",
        source: "role",
        priority: 100,
        stability: "stable",
        cacheable: true,
        content: "identity",
      },
      {
        id: "memory.base",
        section: "memory",
        source: "memory",
        priority: 100,
        stability: "stable",
        cacheable: true,
        content: "memory",
      },
      {
        id: "situation.dynamic",
        section: "situation",
        source: "scenario",
        priority: 100,
        stability: "dynamic",
        content: "situation",
      },
    ]);

    const emitted = await (
      service as unknown as {
        emitPromptBlocks: (
          template: string,
          scope: Record<string, unknown>,
          options?: { providerType?: string },
        ) => Promise<{
          sections: Array<{ name: string; content: string }>;
          stableBlock: string;
          dynamicBlock: string;
          stableSignature: string;
        }>;
      }
    ).emitPromptBlocks("system", {}, { providerType: "anthropic" });

    const canonicalOrder = emitted.sections.map((section) => section.name).join(" -> ");
    expect(canonicalOrder).toBe("identity -> memory -> situation");
    expect(emitted.stableBlock).toContain("identity");
    expect(emitted.stableBlock).toContain("memory");
    expect(emitted.dynamicBlock).toContain("situation");
  });
});
