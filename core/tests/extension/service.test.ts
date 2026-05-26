import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
  class Service {
    ctx: unknown;
    [Symbol.for("koishi.tracker")]: unknown;

    constructor(ctx: unknown, _name: string) {
      this.ctx = ctx;
    }
  }

  return {
    Context: class {},
    Logger: class {},
    Service,
  };
});

import { ExtensionService } from "../../src/services/extension/service.js";
import type { ExtensionDefinition } from "../../src/services/extension/types.js";

function createExtensionService() {
  const logger = { level: 2, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx = { logger: vi.fn().mockReturnValue(logger) };
  return new ExtensionService(ctx as never, {
    basePath: "/tmp/athena-test",
    chatModel: "test-model",
  });
}

function makeExtension(id: string): ExtensionDefinition {
  return { id, setup: vi.fn() };
}

describe("ExtensionService public registry", () => {
  it("stores definitions and notifies definition subscribers on registration", async () => {
    const service = createExtensionService();
    const listener = vi.fn().mockResolvedValue({
      totalChannels: 1,
      successCount: 1,
      failureCount: 0,
      results: [{ channelKey: "onebot:group-1", success: true, loadedCount: 1 }],
      allSucceeded: true,
    });

    service.subscribeDefinitions(listener);
    const extension = makeExtension("ext-a");
    const summary = await service.registerExtension(extension);

    expect(service.getExtension("ext-a")).toBe(extension);
    expect(service.getAllDefinitions()).toEqual([extension]);
    expect(listener).toHaveBeenCalledWith({ type: "registered", extensionId: "ext-a" });
    expect(summary).toMatchObject({ totalChannels: 1, allSucceeded: true });
  });

  it("removes definitions and notifies definition subscribers on unregistration", async () => {
    const service = createExtensionService();
    const listener = vi.fn().mockResolvedValue({
      totalChannels: 0,
      successCount: 0,
      failureCount: 0,
      results: [],
      allSucceeded: true,
    });

    service.subscribeDefinitions(listener);
    await service.registerExtension(makeExtension("ext-a"));
    listener.mockClear();

    const summary = await service.unregisterExtension("ext-a");

    expect(service.getExtension("ext-a")).toBeUndefined();
    expect(listener).toHaveBeenCalledWith({ type: "unregistered", extensionId: "ext-a" });
    expect(summary.allSucceeded).toBe(true);
  });

  it("does not own per-channel runtime state", () => {
    const service = createExtensionService() as unknown as { channels?: unknown };

    expect(service.channels).toBeUndefined();
  });
});
