import { describe, expect, it, vi } from "vitest";

import type { ExtensionDefinition } from "../../../src/internal/extension/types.js";

describe("ChannelSession extension context", () => {
  it("types extension hook handlers from event names", () => {
    const extension: ExtensionDefinition = {
      id: "typed-hooks",
      setup(ctx) {
        ctx.on("agent:before-start", (event) => ({
          systemPrompt: `${event.systemPrompt}|typed`,
        }));
        ctx.on("tool:execution:end", (event) => {
          event.toolName.toUpperCase();
        });
      },
    };

    expect(extension.id).toBe("typed-hooks");
  });

  it("exposes grouped extension context facets", async () => {
    const seen: string[] = [];
    const extension: ExtensionDefinition = {
      id: "grouped-context",
      setup(ctx) {
        seen.push(ctx.channel.platform);
        ctx.tool.register({
          name: "sample_tool",
          description: "sample",
          inputSchema: {} as never,
          execute: vi.fn(),
        });
        ctx.tool.setActive(["sample_tool"]);
        ctx.session.setName("grouped session");
        ctx.session.appendEntry("test:entry", { ok: true });
        ctx.session.sendMessage({ customType: "test:message" });
        ctx.session.sendUserMessage("hello");
        ctx.bot.registerSpeakElement({
          tag: "sample",
          syntax: "<sample/>",
          description: "sample element",
          transform: () => "sample",
        });
        ctx.on("agent:start", () => undefined);
      },
    };

    expect(extension.id).toBe("grouped-context");
    expect(seen).toEqual([]);
  });
});
