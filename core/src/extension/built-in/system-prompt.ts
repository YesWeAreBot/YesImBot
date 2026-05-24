/**
 * Built-in system-prompt extension factory.
 *
 * Extracted from RuntimeService's inline extension.
 * Creates an AthenaExtensionDefinition that builds the Athena system prompt
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

import { buildAthenaSystemPrompt, ensurePersonaFile } from "../../runtime/system-prompt.js";
import type { AthenaExtensionDefinition, ChannelContext } from "../types.js";

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
   * Resolve bot info for a given channel context.
   * Called once per agent:before-start event.
   */
  resolveBotInfo: (context: ChannelContext) => BotInfo;
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
): AthenaExtensionDefinition {
  const { basePath, resolveBotInfo } = options;
  const personaPath = `${basePath}/PERSONA.md`;
  const agentsPath = `${basePath}/AGENTS.md`;

  return {
    id: "yesimbot:system-prompt",
    order: -1000,
    setup(api, context?: ChannelContext) {
      api.on("agent:before-start", async (event) => {
        const persona = await ensurePersonaFile(personaPath);

        let additionalInstructions: string | undefined;
        try {
          const { readFile } = await import("node:fs/promises");
          additionalInstructions = await readFile(agentsPath, "utf-8");
        } catch {
          // AGENTS.md is optional
        }

        const env = context
          ? {
              platform: context.platform,
              channelId: context.channelId,
              type: context.type,
              ...resolveBotInfo(context),
            }
          : {
              platform: "unknown",
              channelId: "unknown",
              type: "group" as const,
              selfId: "unknown",
              selfName: "(unknown)",
            };

        return {
          systemPrompt: buildAthenaSystemPrompt({
            persona,
            additionalInstructions,
            environment: env,
            selectedTools: event.systemPromptOptions.selectedTools,
            toolSnippets: event.systemPromptOptions.toolSnippets,
            promptGuidelines: event.systemPromptOptions.promptGuidelines,
          }),
        };
      });
    },
  };
}
