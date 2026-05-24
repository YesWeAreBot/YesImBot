import { describe, it, expect, vi, beforeEach } from "vitest";

import { GenericAdapter } from "../../src/adapter/generic.js";

function createMockCtx() {
  let middlewareHandler: ((session: unknown, next: unknown) => unknown) | null = null;
  return {
    middleware(handler: (session: unknown, next: unknown) => unknown) {
      middlewareHandler = handler;
      return () => {
        middlewareHandler = null;
      };
    },
    platform: vi.fn().mockReturnThis(),
    on: vi.fn(),
    get _middlewareHandler() {
      return middlewareHandler;
    },
  };
}

describe("GenericAdapter", () => {
  let ctx: ReturnType<typeof createMockCtx>;
  let adapter: GenericAdapter;

  beforeEach(() => {
    ctx = createMockCtx();
    adapter = new GenericAdapter(ctx, {});
    adapter.install(vi.fn());
  });

  it("keeps wildcard platform compatibility", () => {
    expect(adapter.platform).toBe("*");
  });

  it("does not install Koishi middleware anymore", () => {
    expect(ctx._middlewareHandler).toBeNull();
  });
});
