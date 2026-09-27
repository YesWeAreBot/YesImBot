import type { CharacterCardV3 } from "@risuai/ccardlib";
import { createMemoryStorage, type Agent, type StepOptions } from "koishi-plugin-yesimbot";
import { describe, expect, it } from "vitest";

import { createRoleplayPlugin } from "../src/roleplay.js";

const step = (): StepOptions => ({ turnId: "turn", stepNumber: 0, messages: [{ role: "user", content: "hello" }] }) as unknown as StepOptions;

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

  it("renders one frozen prompt envelope around every model step", async () => {
    const card = createCard();
    card.data.description = "A {{pick:bright,dark}} character.";
    card.data.personality = "Mood: {{random:calm,kind}}.";
    card.data.scenario = "Roll: {{roll:d6}}.";
    card.data.system_prompt = "Protect {{user}}.";
    card.data.mes_example = "<START>\n{{char}}: Hello";
    card.data.post_history_instructions = "Answer {{user}} last.";
    const plugin = createRoleplayPlugin({ card, greeting: "", userName: "direct-user", random: () => 0.8 });

    const first = (await plugin.prepareStep!(step())).messages;
    const second = (await plugin.prepareStep!(step())).messages;
    const instructions = await plugin.extendInstructions!();
    expect(instructions).toContain("Protect direct-user.");
    expect(instructions).toContain("<example_dialogues>");
    expect(first).toEqual([
      { role: "system", content: "Name: Athena\n\nA dark character.\n\nPersonality:\nMood: kind.\n\nScenario:\nRoll: 5." },
      { role: "user", content: "hello" },
      { role: "system", content: "Answer direct-user last." },
    ]);
    expect(second).toEqual(first);
  });
});
