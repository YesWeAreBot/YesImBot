/**
 * Built-in system-prompt extension factory.
 *
 * Extracted from the legacy runtime service's inline extension.
 * Creates an ExtensionDefinition that builds the Athena system prompt
 * on every agent:before-start event, reading persona and agent instructions
 * from the configured basePath.
 *
 * Usage:
 *   import { createSystemPromptExtension } from "./built-in/system-prompt.js";
 *   const ext = createSystemPromptExtension({
 *     basePath: "/path/to/data",
 *     resolveBotInfo: (ctx) => ({ selfId: bot.selfId, selfName: bot.user?.name }),
 *   });
 *   extensionService.registerExtension(ext);
 */

import { buildAthenaSystemPrompt, ensurePersonaFile } from "../../../internal/runtime/prompt.js";
import type { Channel, ExtensionDefinition, SpeakElementPromptContext } from "../types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Bot identity info needed for system prompt construction.
 */
export interface BotInfo {
  selfId: string;
  selfName: string;
}

/**
 * Options for creating the system-prompt extension.
 */
export interface SystemPromptExtensionOptions {
  /** Base data directory (contains PERSONA.md, AGENTS.md) */
  basePath: string;
  /**
   * Resolve bot info for a given channel.
   * Called once per agent:before-start event.
   */
  resolveBotInfo: (channel: Channel) => BotInfo;
  /**
   * Resolve tool prompt context for a given channel.
   * When provided, the extension will use this to get selectedTools,
   * toolSnippets, and promptGuidelines from core-owned bindings.
   */
  getToolPromptContext?: (channel: Channel) => {
    selectedTools: string[];
    toolSnippets: Record<string, string>;
    promptGuidelines: string[];
  };
  /**
   * Resolve speak element prompt context for a given channel.
   * When provided, the extension will use this to get model-visible message elements.
   */
  getSpeakElementPromptContext?: (channel: Channel) => SpeakElementPromptContext;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a built-in extension that assembles the Athena system prompt.
 *
 * Order: -1000 (runs before all user extensions to establish the base prompt).
 */
export function createSystemPromptExtension(
  options: SystemPromptExtensionOptions,
): ExtensionDefinition {
  const { basePath, resolveBotInfo, getToolPromptContext, getSpeakElementPromptContext } = options;
  const personaPath = `${basePath}/PERSONA.md`;
  const agentsPath = `${basePath}/AGENTS.md`;

  return {
    id: "yesimbot:system-prompt",
    order: -1000,
    setup(ctx) {
      ctx.on("agent:before-start", (async (_event: { systemPrompt: string }) => {
        const persona = await ensurePersonaFile(personaPath);

        let additionalInstructions: string | undefined;
        try {
          const { readFile } = await import("node:fs/promises");
          additionalInstructions = await readFile(agentsPath, "utf-8");
        } catch {
          // AGENTS.md is optional
        }

        const channel = ctx.channel;
        const env = {
          platform: channel.platform,
          channelId: channel.channelId,
          type: channel.type,
          ...resolveBotInfo(channel),
        };

        // Resolve tool prompt context from core helper
        const toolContext = getToolPromptContext
          ? getToolPromptContext(channel)
          : {
              selectedTools: [] as string[],
              toolSnippets: {} as Record<string, string>,
              promptGuidelines: [] as string[],
            };

        const speakElementContext = getSpeakElementPromptContext
          ? getSpeakElementPromptContext(channel)
          : { elements: [] };

        return {
          systemPrompt: buildAthenaSystemPrompt({
            persona,
            additionalInstructions,
            environment: env,
            selectedTools: toolContext.selectedTools,
            toolSnippets: toolContext.toolSnippets,
            promptGuidelines: toolContext.promptGuidelines,
            speakElements: speakElementContext.elements,
          }),
        };
      }) as (...args: unknown[]) => unknown);
    },
  };
}
