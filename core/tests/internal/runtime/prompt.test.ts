import { describe, expect, it } from "vitest";

import { buildAthenaSystemPrompt } from "../../../src/internal/runtime/prompt.js";

const base = {
  persona: "Athena persona",
  environment: {
    platform: "onebot",
    channelId: "group-1",
    type: "group" as const,
    selfId: "bot-1",
    selfName: "Athena",
  },
  selectedTools: [] as string[],
  toolSnippets: {} as Record<string, string>,
};

describe("buildAthenaSystemPrompt message elements", () => {
  it("renders speak elements in a dedicated section", () => {
    const prompt = buildAthenaSystemPrompt({
      ...base,
      speakElements: [
        {
          tag: "sep",
          syntax: "<sep/>",
          description:
            "Split one assistant reply into multiple platform messages with natural delays.",
          examples: ["这个啊<sep/>我想一下..."],
        },
        {
          tag: "sticker",
          syntax: '<sticker name="NAME"/>',
          description: "Send a known sticker by name.",
          examples: ['<sticker name="吃瓜"/>'],
        },
      ],
    });

    expect(prompt).toContain("## Message Elements");
    expect(prompt).toContain("Only use tags listed here.");
    expect(prompt).toContain("- `<sep/>`: Split one assistant reply");
    expect(prompt).toContain('- `<sticker name="NAME"/>`: Send a known sticker by name.');
    expect(prompt).toContain('Example: `<sticker name="吃瓜"/>`');
  });

  it("defaults to the core sep element when none are provided", () => {
    const prompt = buildAthenaSystemPrompt(base);

    expect(prompt).toContain("## Message Elements");
    expect(prompt).toContain(
      "- `<sep/>`: Split one assistant reply into multiple platform messages with natural delays.",
    );
  });

  it("does not hard-code at mention markup", () => {
    const prompt = buildAthenaSystemPrompt({
      ...base,
      speakElements: [
        {
          tag: "sep",
          syntax: "<sep/>",
          description:
            "Split one assistant reply into multiple platform messages with natural delays.",
          examples: [],
        },
      ],
    });

    expect(prompt).toContain("## Message Elements");
    expect(prompt).not.toContain('<at id="USER_ID"/>');
  });
});
