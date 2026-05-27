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

import type { ExtensionDefinition } from "../../../src/internal/extension/types.js";
import { ExtensionService } from "../../../src/services/extension/service.js";

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
  it("registers definitions and notifies subscribers without returning reload summaries", async () => {
    const service = createExtensionService();
    const listener = vi.fn();
    service.subscribeDefinitions(listener);

    await expect(
      service.registerExtension({
        id: "sample",
        setup: () => undefined,
      }),
    ).resolves.toBeUndefined();

    expect(service.getExtension("sample")?.id).toBe("sample");
    expect(listener).toHaveBeenCalledWith({ type: "registered", extensionId: "sample" });
  });

  it("unregisters definitions and notifies subscribers without runtime manager attachment", async () => {
    const service = createExtensionService();
    const listener = vi.fn();
    service.subscribeDefinitions(listener);
    await service.registerExtension({ id: "sample", setup: () => undefined });

    await expect(service.unregisterExtension("sample")).resolves.toBeUndefined();

    expect(service.getExtension("sample")).toBeUndefined();
    expect(listener).toHaveBeenLastCalledWith({ type: "unregistered", extensionId: "sample" });
  });

  it("does not expose per-channel runtime forwarding methods", () => {
    const service = createExtensionService() as Record<string, unknown>;

    expect(service.attachRuntimeManager).toBeUndefined();
    expect(service.createChannelRuntime).toBeUndefined();
    expect(service.disposeChannelRuntime).toBeUndefined();
    expect(service.getChannelRuntime).toBeUndefined();
    expect(service.buildToolSnapshot).toBeUndefined();
    expect(service.getPromptToolContext).toBeUndefined();
    expect(service.getPromptSpeakElementContext).toBeUndefined();
  });
});
