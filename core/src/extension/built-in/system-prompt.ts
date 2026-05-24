/**
 * Built-in system-prompt extension factory.
 *
 * Extracted from RuntimeService's inline extension.
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

import { buildAthenaSystemPrompt, ensurePersonaFile } from "../../runtime/system-prompt.js";
import type { ChannelContext, ExtensionDefinition } from "../types.js";

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
  /**
   * Resolve tool prompt context for a given channel context.
   * When provided, the extension will use this to get selectedTools,
   * toolSnippets, and promptGuidelines from core-owned bindings.
   */
  getToolPromptContext?: (context: ChannelContext) => {
    selectedTools: string[];
    toolSnippets: Record<string, string>;
    promptGuidelines: string[];
  };
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
  const { basePath, resolveBotInfo, getToolPromptContext } = options;
  const personaPath = `${basePath}/PERSONA.md`;
  const agentsPath = `${basePath}/AGENTS.md`;

  return {
    id: "yesimbot:system-prompt",
    order: -1000,
    setup(api) {
      api.on("agent:before-start", (async (event: { systemPrompt: string }) => {
        const persona = await ensurePersonaFile(personaPath);

        let additionalInstructions: string | undefined;
        try {
          const { readFile } = await import("node:fs/promises");
          additionalInstructions = await readFile(agentsPath, "utf-8");
        } catch {
          // AGENTS.md is optional
        }

        const context = api.channel;
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

        // Resolve tool prompt context from core helper
        const toolContext =
          context && getToolPromptContext
            ? getToolPromptContext(context)
            : {
                selectedTools: [] as string[],
                toolSnippets: {} as Record<string, string>,
                promptGuidelines: [] as string[],
              };

        return {
          systemPrompt: buildAthenaSystemPrompt({
            persona,
            additionalInstructions,
            environment: env,
            selectedTools: toolContext.selectedTools,
            toolSnippets: toolContext.toolSnippets,
            promptGuidelines: toolContext.promptGuidelines,
          }),
        };
      }) as (...args: unknown[]) => unknown);
    },
  };
}
