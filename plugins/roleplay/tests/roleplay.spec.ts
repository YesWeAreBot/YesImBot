import type { CharacterCardV3 } from "@risuai/ccardlib";
import { createMemoryStorage, type Agent } from "koishi-plugin-yesimbot";
import { describe, expect, it } from "vitest";

import { createRoleplayPlugin } from "../src/roleplay.js";

function createCard(): CharacterCardV3 {
  return {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "Athena",
      description: "A careful character.",
      personality: "Calm",
      scenario: "A quiet room.",
      first_mes: "Hello, {{user}}.",
      mes_example: "",
      alternate_greetings: [],
      group_only_greetings: [],
      character_version: "1",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      tags: [],
      creator: "",
      extensions: {},
    },
  };
}

describe("roleplay agent plugin", () => {
  it("persists the rendered first greeting for an empty session", async () => {
    const storage = createMemoryStorage();
    const plugin = createRoleplayPlugin({ card: createCard(), greeting: "Hello, {{user}}.", userName: "direct-user" });

    await plugin.init?.({ storage } as unknown as Agent);

    expect(storage.read()).toEqual([
      expect.objectContaining({ type: "message", data: expect.objectContaining({ role: "assistant", content: "Hello, direct-user." }) }),
    ]);
  });

  it("uses the card nickname for {{char}} substitutions", async () => {
    const card = createCard();
    card.data.nickname = "Nyx";
    const storage = createMemoryStorage();
    const plugin = createRoleplayPlugin({ card, greeting: "Hello, {{char}}.", userName: "direct-user" });

    await plugin.init?.({ storage } as unknown as Agent);

    expect(storage.read()).toEqual([
      expect.objectContaining({ type: "message", data: expect.objectContaining({ role: "assistant", content: "Hello, Nyx." }) }),
    ]);
  });

  it("folds the character definition and post-history instructions into the prompt instructions", async () => {
    const card = createCard();
    card.data.description = "A {{pick:bright,dark}} character.";
    card.data.personality = "Mood: {{random:calm,kind}}.";
    card.data.scenario = "Roll: {{roll:d6}}.";
    card.data.system_prompt = "Protect {{user}}.";
    card.data.mes_example = "<START>\n{{char}}: Hello";
    card.data.post_history_instructions = "Answer {{user}} last.";
    const plugin = createRoleplayPlugin({ card, greeting: "", userName: "direct-user", random: () => 0.8 });

    const first = await plugin.extendInstructions!();
    const second = await plugin.extendInstructions!();
    expect(first).toContain("Protect direct-user.");
    expect(first).toContain("<example_dialogues>");
    expect(first).toContain("Name: Athena\n\nA dark character.\n\nPersonality:\nMood: kind.\n\nScenario:\nRoll: 5.");
    expect(first).toContain("Answer direct-user last.");
    expect(second).toEqual(first);
    expect(plugin.prepareStep).toBeUndefined();
  });
});
