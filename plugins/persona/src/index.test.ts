import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
  const createStringSchema = () => {
    const chain = {
      default: vi.fn(() => chain),
      description: vi.fn(() => chain),
      role: vi.fn(() => chain),
    };
    return chain;
  };

  const createObjectSchema = () => {
    const chain = {
      description: vi.fn(() => chain),
      i18n: vi.fn(() => chain),
    };
    return chain;
  };

  return {
    Context: class {},
    Schema: {
      object: vi.fn(() => createObjectSchema()),
      string: vi.fn(() => createStringSchema()),
    },
  };
});

import { apply, buildPersonaText } from "./index";

describe("persona plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buildPersonaText returns empty text when no fields are configured", () => {
    expect(
      buildPersonaText({
        name: "",
        personality: "",
        tone: "",
        extra: "",
      }),
    ).toBe("");
  });

  it("registers a v4 prompt fragment source when registerFragmentSource is available", async () => {
    const dispose = vi.fn();
    let registeredProvider:
      | ((scope: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>)
      | undefined;
    const registerFragmentSource = vi.fn(
      (_name: string, provider: (scope: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>) => {
        registeredProvider = provider;
        return dispose;
      },
    );
    const on = vi.fn();
    const ctx = {
      on,
      "yesimbot.prompt": {
        registerFragmentSource,
      },
    };

    apply(ctx as never, {
      name: "Athena",
      personality: "Curious and playful",
      tone: "Warm and direct",
      extra: "Likes concise answers",
    });

    expect(registerFragmentSource).toHaveBeenCalledTimes(1);
    expect(registerFragmentSource).toHaveBeenCalledWith("persona", expect.any(Function));
    expect(on).toHaveBeenCalledWith("dispose", expect.any(Function));

    const fragments = await registeredProvider?.({});

    expect(fragments).toEqual([
      expect.objectContaining({
        id: "persona.supplement",
        section: "identity",
        source: "hook",
        stability: "stable",
        priority: 695,
        cacheable: true,
      }),
    ]);
    expect(String(fragments?.[0]?.content)).toContain("Athena");
    expect(String(fragments?.[0]?.content)).toContain("Curious and playful");
  });

  it("throws when fragment registration is unavailable", () => {
    const ctx = {
      on: vi.fn(),
      "yesimbot.prompt": {},
    };

    expect(() =>
      apply(ctx as never, {
        name: "Athena",
        personality: "",
        tone: "",
        extra: "",
      }),
    ).toThrowError("yesimbot.prompt does not expose registerFragmentSource().");
  });
});
