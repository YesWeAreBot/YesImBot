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
      path: vi.fn(() => ({
        default: vi.fn(),
      })),
      object: vi.fn(() => ({
        description: vi.fn(),
      })),
      string: vi.fn(() => ({
        default: vi.fn(),
      })),
      boolean: vi.fn(() => ({
        default: vi.fn(),
      })),
      number: vi.fn(() => ({
        min: vi.fn().mockReturnThis(),
        default: vi.fn(),
      })),
    },
    Service,
  };
});

import { PersonaService } from "../src/services/role/service";

function createMockContext() {
  const fragmentSources = new Map<string, (scope: Record<string, unknown>) => unknown>();
  const snippets = new Map<string, (scope: Record<string, unknown>) => unknown>();

  const promptService = {
    inject: vi.fn(),
    registerFragmentSource: vi.fn(
      (name: string, provider: (scope: Record<string, unknown>) => unknown) => {
        fragmentSources.set(name, provider);
        return vi.fn();
      },
    ),
    registerSnippet: vi.fn((name: string, fn: (scope: Record<string, unknown>) => unknown) => {
      snippets.set(name, fn);
    }),
  };

  const ctx: Record<string, unknown> = {
    logger: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    on: vi.fn(),
    "yesimbot.prompt": promptService,
  };

  return { ctx, promptService, fragmentSources, snippets };
}

describe("PersonaService fragment provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not call prompt.inject and emits identity/policy/situation persona fragments", async () => {
    const { ctx, promptService, fragmentSources } = createMockContext();
    const service = new PersonaService(ctx as never, { rolePath: "core/resources/roles" });

    await (service as unknown as { start: () => Promise<void> }).start();

    expect(promptService.inject).not.toHaveBeenCalled();
    expect(promptService.registerFragmentSource).toHaveBeenCalled();

    const provider = fragmentSources.get("persona");
    expect(provider).toBeTypeOf("function");

    const fragments = (await provider?.({
      scenario: {
        raw: {
          self: { name: "Athena" },
          environment: { name: "General", platform: "discord" },
        },
      },
    })) as Array<{
      id: string;
      section: string;
      priority: number;
    }>;

    expect(fragments.map((fragment) => fragment.id)).toEqual([
      "persona.soul",
      "persona.agents",
      "persona.tools",
    ]);
    expect(fragments.map((fragment) => fragment.section)).toEqual([
      "identity",
      "policy",
      "situation",
    ]);
    expect(fragments.map((fragment) => fragment.priority)).toEqual([700, 700, 500]);
  });

  it("keeps snippet-backed persona template data available", async () => {
    const { ctx, snippets } = createMockContext();
    const service = new PersonaService(ctx as never, { rolePath: "core/resources/roles" });

    await (service as unknown as { start: () => Promise<void> }).start();

    expect(
      await snippets.get("sender.name")?.({ percept: { metadata: { senderName: "Alice" } } }),
    ).toBe("Alice");
    expect(
      await snippets.get("bot.name")?.({ scenario: { raw: { self: { name: "Athena" } } } }),
    ).toBe("Athena");
  });
});
