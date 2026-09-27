import type { CharacterCardV3 } from "@risuai/ccardlib";
import { createAssistantMessage, createEntry, type AgentPlugin, type StepOptions } from "koishi-plugin-yesimbot";

import type { CBSContext } from "./cbs.js";
import { renderCBS } from "./cbs.js";
import { assembleCharacterDefinition, assembleInstructionExtension, assemblePostHistoryInstructions } from "./prompt.js";

export interface RoleplayAgentPluginOptions {
  readonly card: CharacterCardV3;
  readonly greeting: string;
  readonly random?: () => number;
  readonly userName: string;
}

export function createRoleplayPlugin(options: RoleplayAgentPluginOptions): AgentPlugin {
  const context: CBSContext = {
    charName: options.card.data.nickname ?? options.card.data.name,
    pickCache: new Map<string, string>(),
    random: options.random,
    userName: options.userName,
  };
  const instructionExtension = assembleInstructionExtension(options.card, context);
  const characterDefinition = assembleCharacterDefinition(options.card, context);
  const postHistoryInstructions = assemblePostHistoryInstructions(options.card, context);
  const greeting = renderCBS(options.greeting, context).text;
  const prefix = characterDefinition.length > 0 ? [{ role: "system" as const, content: characterDefinition }] : [];
  const suffix = postHistoryInstructions.length > 0 ? [{ role: "system" as const, content: postHistoryInstructions }] : [];

  return {
    name: "roleplay",
    extendInstructions: () => instructionExtension || undefined,
    async init(agent) {
      const entries = await agent.storage.read();
      if (entries.some((entry) => entry.type === "message") || greeting.length === 0) return;
      await agent.storage.append(createEntry("message", createAssistantMessage(greeting)));
    },
    prepareStep(options: StepOptions) {
      return { ...options, messages: [...prefix, ...options.messages, ...suffix] };
    },
  };
}
