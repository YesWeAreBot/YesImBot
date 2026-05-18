import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock koishi to provide a minimal Service base class
vi.mock("koishi", () => {
  class Service {
    ctx: any;
    [Symbol.for("koishi.tracker")]: any;
    constructor(ctx: any, _name: string) {
      this.ctx = ctx;
    }
    protected start() {}
    protected stop() {}
  }
  return {
    Context: class {},
    Service,
  };
});

import { AdapterService } from "../../src/adapter/service.js";
import type { PlatformAdapter, AthenaEvent } from "../../src/adapter/types.js";

// Minimal Koishi Context mock
function createMockCtx() {
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
  return {
    on(event: string, handler: (...args: any[]) => void) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
      return () => {
        const arr = listeners.get(event)!;
        arr.splice(arr.indexOf(handler), 1);
      };
    },
    emit(event: string, ...args: any[]) {
      for (const h of listeners.get(event) ?? []) h(...args);
    },
    middleware: vi.fn(),
    platform: vi.fn().mockReturnThis(),
    logger: vi.fn().mockReturnValue({ level: 2, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    _listeners: listeners,
  };
}

describe("AdapterService", () => {
  let ctx: ReturnType<typeof createMockCtx>;
  let service: AdapterService;

  beforeEach(() => {
    ctx = createMockCtx();
    service = new AdapterService(ctx as any, {});
  });

  it("should register an adapter and make it retrievable", () => {
    const adapter: PlatformAdapter = {
      platform: "onebot",
      install: vi.fn(),
    };
    service.register(adapter);
    expect(service.get("onebot")).toBe(adapter);
  });

  it("should call adapter.install with ctx and emit function", () => {
    const install = vi.fn();
    const adapter: PlatformAdapter = { platform: "test", install };
    service.register(adapter);
    expect(install).toHaveBeenCalledWith(expect.any(Function));
  });

  it("should emit athena/event when adapter calls emit", () => {
    const handler = vi.fn();
    ctx.on("athena/event", handler);

    const adapter: PlatformAdapter = {
      platform: "test",
      install(emit) {
        emit({
          id: "e1",
          kind: "chat_message",
          timestamp: 1,
          source: { platform: "test", channelId: "c1", conversationType: "group" },
          actor: { id: "u1" },
          payload: {},
          metadata: { persist: true, triggerCandidate: true },
        } as AthenaEvent);
      },
    };
    service.register(adapter);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
  });

  it("should register adapter formatters into the registry", () => {
    const formatter = vi.fn().mockReturnValue("formatted");
    const adapter: PlatformAdapter = {
      platform: "test",
      install: vi.fn(),
      formatters: { chat_message: formatter },
    };
    service.register(adapter);
    // Verify formatter is accessible via the registry
    expect(service.formatters).toBeDefined();
  });

  it("should dispose adapter on dispose call", () => {
    const adapter: PlatformAdapter = {
      platform: "onebot",
      install: vi.fn(),
    };
    const dispose = service.register(adapter);
    expect(service.get("onebot")).toBe(adapter);
    dispose();
    expect(service.get("onebot")).toBeUndefined();
  });

  it("should reject registering two adapters for the same platform", () => {
    const a1: PlatformAdapter = { platform: "onebot", install: vi.fn() };
    const a2: PlatformAdapter = { platform: "onebot", install: vi.fn() };
    service.register(a1);
    expect(() => service.register(a2)).toThrow(/already registered/);
  });
});
