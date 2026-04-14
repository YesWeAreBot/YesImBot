import type {
  RegisteredToolDefinition,
  ToolExtensionContext,
  ToolRuntime,
} from "@yesimbot/plugin-sdk";
import type { ToolSet } from "ai";

import { createSendMessageTool } from "./send-message-tool";

const SEND_MESSAGE_TOOL = "send_message";

export interface ToolAssemblySettings {
  enabled?: string[];
  required?: string[];
}

export type ToolAssemblyContextFactory<THostInput = unknown> = (
  hostInput: THostInput,
  runtime: ToolRuntime,
) => Record<string, unknown> | undefined;

export type ToolAssemblySourceContributor = RegisteredToolDefinition;

export interface BuildToolAssemblyOptions<THostInput = unknown> {
  runtime: ToolRuntime;
  hostInput: THostInput;
  pluginToolDefinitions: RegisteredToolDefinition[];
  sourceToolDefinitions: ToolAssemblySourceContributor[];
  toolSettings?: ToolAssemblySettings;
  contextFactories?: Partial<Record<string, ToolAssemblyContextFactory<THostInput>>>;
  sendMessageTool?: ToolSet[typeof SEND_MESSAGE_TOOL];
}

export interface ToolAssemblyResult {
  supportedTools: ToolSet;
  activeTools: ToolSet;
  experimentalContext: ToolExtensionContext;
  signature: string;
}

interface NormalizedToolEntry {
  source: "plugin" | "source";
  definition: RegisteredToolDefinition;
}

export function buildToolAssembly<THostInput = unknown>(
  options: BuildToolAssemblyOptions<THostInput>,
): ToolAssemblyResult {
  const enabledTools = [...new Set(options.toolSettings?.enabled ?? [])];
  const requiredTools = [...new Set(options.toolSettings?.required ?? [])];
  const normalizedDefinitions = normalizeToolDefinitions(
    options.pluginToolDefinitions,
    options.sourceToolDefinitions,
  );
  const experimentalContext: ToolExtensionContext = {};
  const builtContextPlugins = new Set<string>();
  const supportedTools: ToolSet = {
    [SEND_MESSAGE_TOOL]: options.sendMessageTool ?? createNoopSendMessageTool(),
  };
  const activeTools: ToolSet = {
    [SEND_MESSAGE_TOOL]: supportedTools[SEND_MESSAGE_TOOL],
  };

  for (const entry of normalizedDefinitions) {
    const { definition } = entry;
    const isSupported = definition.definition.isSupported?.({ runtime: options.runtime }) ?? true;
    if (!isSupported) {
      continue;
    }

    ensurePluginExperimentalContext({
      pluginName: definition.pluginName,
      contextFactories: options.contextFactories,
      builtContextPlugins,
      hostInput: options.hostInput,
      runtime: options.runtime,
      experimentalContext,
    });

    supportedTools[definition.name] = definition.tool;

    const isAllowed =
      definition.definition.isAllowed?.({
        runtime: options.runtime,
        extensionContext: experimentalContext,
        enabledTools,
      }) ?? enabledTools.includes(definition.name);

    if (enabledTools.includes(definition.name) && isAllowed) {
      activeTools[definition.name] = definition.tool;
    }
  }

  assertRequiredTools(requiredTools, supportedTools, activeTools);

  return {
    supportedTools,
    activeTools,
    experimentalContext,
    signature: JSON.stringify(Object.keys(supportedTools).sort()),
  };
}

function normalizeToolDefinitions(
  pluginToolDefinitions: RegisteredToolDefinition[],
  sourceToolDefinitions: RegisteredToolDefinition[],
): NormalizedToolEntry[] {
  const seen = new Set<string>();
  const normalized: NormalizedToolEntry[] = [];

  for (const definition of pluginToolDefinitions) {
    normalized.push(registerToolDefinition(definition, seen, "plugin"));
  }

  for (const definition of sourceToolDefinitions) {
    normalized.push(registerToolDefinition(definition, seen, "source"));
  }

  return normalized;
}

function registerToolDefinition(
  definition: RegisteredToolDefinition,
  seen: Set<string>,
  source: "plugin" | "source",
): NormalizedToolEntry {
  if (definition.name === SEND_MESSAGE_TOOL) {
    throw new Error(`Tool name reserved: ${SEND_MESSAGE_TOOL}`);
  }

  if (seen.has(definition.name)) {
    throw new Error(`Duplicate explicit tool name: ${definition.name}`);
  }

  seen.add(definition.name);
  return {
    source,
    definition,
  };
}

function ensurePluginExperimentalContext<THostInput>(input: {
  pluginName: string;
  contextFactories: Partial<Record<string, ToolAssemblyContextFactory<THostInput>>> | undefined;
  builtContextPlugins: Set<string>;
  hostInput: THostInput;
  runtime: ToolRuntime;
  experimentalContext: ToolExtensionContext;
}): void {
  if (input.builtContextPlugins.has(input.pluginName)) {
    return;
  }

  input.builtContextPlugins.add(input.pluginName);
  const factory = input.contextFactories?.[input.pluginName];
  if (!factory) {
    return;
  }

  const pluginContext = factory(input.hostInput, input.runtime);
  if (pluginContext !== undefined) {
    input.experimentalContext[input.pluginName] = pluginContext;
  }
}

function assertRequiredTools(
  requiredTools: string[],
  supportedTools: ToolSet,
  activeTools: ToolSet,
): void {
  for (const name of requiredTools) {
    if (name === SEND_MESSAGE_TOOL) {
      continue;
    }

    if (!(name in supportedTools)) {
      throw new Error(`tools.required missing supported tool: ${name}`);
    }

    if (!(name in activeTools)) {
      throw new Error(`tools.required missing active tool: ${name}`);
    }
  }
}

function createNoopSendMessageTool(): ToolSet[typeof SEND_MESSAGE_TOOL] {
  return createSendMessageTool({
    bot: {
      selfId: "offline-send-message",
      sendMessage: async () => undefined,
    } as never,
    channelId: "offline-channel",
  });
}
