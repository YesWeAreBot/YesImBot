import { describe, expect, it } from "vitest";

import { buildAthenaSystemPrompt } from "../../src/runtime/system-prompt";

describe("buildAthenaSystemPrompt", () => {
  const defaultOptions = {
    persona: "persona text",
    additionalInstructions: "agent text",
    environment: {
      platform: "onebot",
      channelId: "123",
      type: "group" as const,
      selfId: "42",
      selfName: "Athena",
    },
    selectedTools: ["read"],
    toolSnippets: { read: "read files" },
    promptGuidelines: ["先判断是否介入"],
  };

  it("renders Role Boundary, Persona, Additional Instructions, Environment, Interaction Principles, Message Segmentation, and Tools in order", () => {
    const prompt = buildAthenaSystemPrompt(defaultOptions);

    expect(prompt).toContain("<persona>");
    expect(prompt).toContain("<additional_instructions>");
    expect(prompt).toContain("Message Segmentation");
    expect(prompt).toContain("<sep/>");
    expect(prompt.indexOf("Role Boundary")).toBeLessThan(prompt.indexOf("Persona"));
    expect(prompt.indexOf("Persona")).toBeLessThan(prompt.indexOf("Additional Instructions"));
    expect(prompt.indexOf("Additional Instructions")).toBeLessThan(
      prompt.indexOf("Current Environment"),
    );
    expect(prompt.indexOf("Current Environment")).toBeLessThan(
      prompt.indexOf("Interaction Principles"),
    );
    expect(prompt.indexOf("Interaction Principles")).toBeLessThan(
      prompt.indexOf("Message Segmentation"),
    );
    expect(prompt.indexOf("Message Segmentation")).toBeLessThan(prompt.indexOf("Tools"));
  });

  it("includes persona content in <persona> block", () => {
    const prompt = buildAthenaSystemPrompt(defaultOptions);

    expect(prompt).toContain("<persona>\npersona text\n</persona>");
  });

  it("includes additional instructions in <additional_instructions> block", () => {
    const prompt = buildAthenaSystemPrompt(defaultOptions);

    expect(prompt).toContain("<additional_instructions>\nagent text\n</additional_instructions>");
  });

  it("includes environment info in <environment> block", () => {
    const prompt = buildAthenaSystemPrompt(defaultOptions);

    expect(prompt).toContain("<environment>");
    expect(prompt).toContain("Platform: onebot");
    expect(prompt).toContain("Channel ID: 123");
    expect(prompt).toContain("Chat Type: 群聊");
    expect(prompt).toContain("你的ID: 42");
    expect(prompt).toContain("你在此频道的昵称: Athena");
  });

  it("includes tool snippets in Tools section", () => {
    const prompt = buildAthenaSystemPrompt(defaultOptions);

    expect(prompt).toContain("**read**: read files");
  });

  it("skips Additional Instructions section when not provided", () => {
    const prompt = buildAthenaSystemPrompt({
      ...defaultOptions,
      additionalInstructions: undefined,
    });

    expect(prompt).not.toContain("<additional_instructions>");
    expect(prompt).toContain("Role Boundary");
    expect(prompt).toContain("<persona>");
  });

  it("includes default interaction principles", () => {
    const prompt = buildAthenaSystemPrompt(defaultOptions);

    expect(prompt).toContain("发言是行为的一种，沉默、观望、延迟回应同样是正当行为");
    expect(prompt).toContain("先判断是否应该介入，再决定如何表达");
    expect(prompt).toContain("上下文不足时，先用工具补足语境，不要胡编乱造");
  });

  it("merges custom prompt guidelines with defaults", () => {
    const prompt = buildAthenaSystemPrompt({
      ...defaultOptions,
      promptGuidelines: ["自定义准则"],
    });

    expect(prompt).toContain("自定义准则");
    expect(prompt).toContain("发言是行为的一种");
  });
});
