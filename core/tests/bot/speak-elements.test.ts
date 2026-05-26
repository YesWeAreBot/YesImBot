import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => {
  const element = await import("@satorijs/element");
  return { h: element.default };
});

import { h } from "koishi";

import { createSpeakElementRegistry } from "../../src/internal/bot/speak.js";

const context = {
  channel: { platform: "onebot", channelId: "group-1", type: "group" as const },
};

describe("SpeakElementRegistry", () => {
  it("always exposes sep as a prompt element", () => {
    const registry = createSpeakElementRegistry();

    expect(registry.getPromptElements()).toEqual([
      {
        tag: "sep",
        syntax: "<sep/>",
        description:
          "Split one assistant reply into multiple platform messages with natural delays.",
        examples: ["这个啊<sep/>我想一下..."],
      },
    ]);
  });

  it("registers extension speak element prompt metadata", () => {
    const registry = createSpeakElementRegistry();
    const dispose = registry.register({
      tag: "sticker",
      syntax: '<sticker name="NAME"/>',
      description: "Send a known sticker by name.",
      examples: ['<sticker name="吃瓜"/>'],
    });

    expect(registry.getPromptElements().map((item) => item.tag)).toEqual(["sep", "sticker"]);

    dispose();
    expect(registry.getPromptElements().map((item) => item.tag)).toEqual(["sep"]);
  });

  it("transforms registered tags and splits on sep", async () => {
    const registry = createSpeakElementRegistry();
    registry.register({
      tag: "sticker",
      syntax: '<sticker name="NAME"/>',
      description: "Send a known sticker by name.",
      transform(element) {
        return h("img", { src: `sticker://${element.attrs.name}` });
      },
    });

    const result = await registry.compile('看这个<sep/><sticker name="吃瓜"/>', context);

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toEqual(["看这个"]);
    expect(result.segments[1]).toEqual([h("img", { src: "sticker://吃瓜" })]);
    expect(result.anomalies).toEqual([]);
  });

  it("escapes unregistered tags as plain text", async () => {
    const registry = createSpeakElementRegistry();

    const result = await registry.compile('hello <unknown value="1"/>', context);

    expect(result.segments).toEqual([['hello <unknown value="1"/>']]);
    expect(result.anomalies).toEqual([]);
  });

  it("records transform failures and keeps surrounding text", async () => {
    const registry = createSpeakElementRegistry();
    registry.register({
      tag: "sticker",
      syntax: '<sticker name="NAME"/>',
      description: "Send a known sticker by name.",
      transform() {
        throw new Error("missing sticker");
      },
    });

    const result = await registry.compile('before <sticker name="不存在"/> after', context);

    expect(result.segments).toEqual([["before ", " after"]]);
    expect(result.anomalies).toHaveLength(1);
    expect(result.anomalies[0]).toMatchObject({
      kind: "transform_failed",
      reason: "missing sticker",
      source: "athena-bot",
    });
  });
});
