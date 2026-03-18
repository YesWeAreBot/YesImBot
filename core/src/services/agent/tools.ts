import { getCapabilityByKey } from "../../runtime/contracts";
import type { PluginService } from "../plugin/service";
import { FunctionType, ToolExecutionContext } from "../plugin/types";
import type { PromptFragment } from "../prompt/types";

const TOOL_PROTOCOL_CONTENT = [
  "## Tool Protocol",
  "",
  "Tools retrieve information or compute results. Actions produce side effects.",
  "",
  "Use tools only when they directly improve accuracy or actionability.",
  "Prefer minimal, deterministic parameters and avoid speculative tool calls.",
  "",
  "If no tool or action is needed, answer directly without calling tools.",
].join("\n");

function buildToolAvailability(
  pluginService: PluginService,
  toolCtx: ToolExecutionContext,
  allowedTools?: string[],
): string {
  let entries = pluginService.getTools(toolCtx);
  if (allowedTools?.length) {
    // Fetch hidden tools that are explicitly included by skill
    const all = pluginService.getTools(toolCtx, true);
    const hidden = all.filter(
      (e) =>
        !entries.some((v) => v.function.name === e.function.name) &&
        allowedTools.includes(e.function.name),
    );
    entries = entries.concat(hidden);
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
  if (allowedTools?.length) {
    const available = new Set(visibleEntries.map((e) => e.function.name));
    for (const name of allowedTools) {
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
  allowedTools?: string[],
): PromptFragment[] {
  const availability = buildToolAvailability(pluginService, toolCtx, allowedTools);
  const availableContent = availability
    ? `<tools>\nTools/actions available this round:\n${availability}\n</tools>`
    : "<tools>\nNo tools/actions are available this round.\n</tools>";

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
