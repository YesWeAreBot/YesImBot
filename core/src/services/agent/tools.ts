import type { PluginService } from "../plugin/service";
import { FunctionType, ToolExecutionContext } from "../plugin/types";
import type { PromptFragment } from "../prompt/types";
import { getCapabilityByKey } from "../runtime/contracts";
import type { ToolFilter } from "../skill/types";

const TOOL_PROTOCOL_CONTENT = [
  "Use tools only when they directly improve accuracy or actionability.",
  "Prefer minimal, deterministic parameters and avoid speculative tool calls.",
  "If no tool is needed, answer directly via send_message.",
].join("\n");

function buildToolAvailability(
  pluginService: PluginService,
  toolCtx: ToolExecutionContext,
  toolFilter?: ToolFilter,
): string {
  let entries = pluginService.getTools(toolCtx);
  if (toolFilter?.include?.length) {
    // Fetch hidden tools that are explicitly included by skill
    const all = pluginService.getTools(toolCtx, true);
    const hidden = all.filter(
      (e) =>
        !entries.some((v) => v.function.name === e.function.name) &&
        toolFilter.include!.includes(e.function.name),
    );
    entries = entries.concat(hidden);
  }
  if (toolFilter?.exclude?.length) {
    entries = entries.filter((e) => !toolFilter.exclude!.includes(e.function.name));
  }

  const visibleEntries: typeof entries = [];
  const unavailableHints: string[] = [];

  for (const entry of entries) {
    const definition = pluginService.getDefinition(entry.function.name);
    if (!definition?.requiredCapabilities?.length) {
      visibleEntries.push(entry);
      continue;
    }

    const missing = definition.requiredCapabilities.filter((key) => {
      const state = getCapabilityByKey(toolCtx.capabilities, key);
      if (!state) {
        console.warn(
          `[capability-gate] Unknown capability key "${key}" required by tool "${entry.function.name}"`,
        );
        return true;
      }
      return state.status !== "available";
    });

    if (missing.length === 0) {
      visibleEntries.push(entry);
      continue;
    }

    const strategy = definition.onCapabilityMissing ?? "remove";
    if (strategy === "hint") {
      unavailableHints.push(
        `- ${entry.function.name}: [unavailable — capabilities missing: ${missing.join(", ")}]`,
      );
    }
  }

  const lines = visibleEntries.map((entry) => {
    const label = entry.functionType === FunctionType.Tool ? "tool" : "action";
    const params = JSON.stringify(entry.function.parameters);
    return `- ${entry.function.name} (${label}): ${entry.function.description}\n  Parameters: ${params}`;
  });
  lines.push(...unavailableHints);

  // Warn about skill-requested tools that don't exist
  if (toolFilter?.include?.length) {
    const available = new Set(visibleEntries.map((e) => e.function.name));
    for (const name of toolFilter.include) {
      if (!available.has(name)) {
        lines.push(`- ${name}: [unavailable — tool not installed]`);
      }
    }
  }
  return lines.join("\n");
}

export function buildToolPromptFragments(
  pluginService: PluginService,
  toolCtx: ToolExecutionContext,
  toolFilter?: ToolFilter,
): PromptFragment[] {
  const availability = buildToolAvailability(pluginService, toolCtx, toolFilter);
  const availableContent = availability
    ? `Available tools/actions this round:\n${availability}`
    : "No tools/actions are available this round.";

  return [
    {
      id: "tooling.protocol",
      content: TOOL_PROTOCOL_CONTENT,
      section: "policy",
      source: "tooling",
      priority: 500,
      stability: "stable",
      cacheable: true,
    },
    {
      id: "tooling.available",
      content: availableContent,
      section: "situation",
      source: "tooling",
      priority: 520,
      stability: "dynamic",
      cacheable: false,
    },
  ];
}

/** @deprecated Use buildToolPromptFragments() for canonical prompt path. */
export function buildToolSchemaForPrompt(
  pluginService: PluginService,
  toolCtx: ToolExecutionContext,
  toolFilter?: ToolFilter,
): string {
  return buildToolAvailability(pluginService, toolCtx, toolFilter);
}
