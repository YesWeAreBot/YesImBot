import type { Tool as AiTool } from "@ai-sdk/provider-utils";
import type { FlexibleSchema, ToolExecutionOptions } from "@ai-sdk/provider-utils";
import type { ToolSet } from "ai";
import type { JSONSchema4 } from "json-schema";
import type { Schema } from "koishi";

export type MixedInputSchema = Schema | JSONSchema4 | FlexibleSchema<unknown>;

export interface ToolRuntimeTurn {
  messageId: string;
  timestamp: number;
  isDirect: boolean;
  atSelf: boolean;
  isReplyToBot: boolean;
}

export interface ToolRuntime {
  channelKey: string;
  platform: string;
  channelId: string;
  modelId: string;
  basePath: string;
  turn: ToolRuntimeTurn;
}

export interface ToolExtensionContext {
  [key: string]: unknown;
}

export interface ToolSupportContext {
  runtime: ToolRuntime;
}

export interface ToolAllowContext extends ToolSupportContext {
  extensionContext: ToolExtensionContext;
  enabledTools: string[];
}

export interface YesImToolDefinition<INPUT = unknown, OUTPUT = unknown> {
  name: string;
  description: string;
  inputSchema: MixedInputSchema;
  builtin?: boolean;
  isSupported?: (context: ToolSupportContext) => boolean;
  isAllowed?: (context: ToolAllowContext) => boolean;
  buildExtensionContext?: (
    hostInput: unknown,
    runtime: ToolRuntime,
  ) => Record<string, unknown> | undefined;
  execute: (input: INPUT, options: ToolExecutionOptions) => PromiseLike<OUTPUT> | OUTPUT;
}

export interface RegisteredToolDefinition<INPUT = unknown, OUTPUT = unknown> {
  pluginName: string;
  name: string;
  definition: YesImToolDefinition<INPUT, OUTPUT>;
  tool: AiTool;
}

export type ToolAssemblyContextFactory<THostInput = unknown> = (
  hostInput: THostInput,
  runtime: ToolRuntime,
) => Record<string, unknown> | undefined;

export interface ToolAssemblySettings {
  enabled?: string[];
  required?: string[];
}

export interface ToolSource<THostInput = unknown> {
  toolDefinitions: RegisteredToolDefinition[];
  contextFactories?: Partial<Record<string, ToolAssemblyContextFactory<THostInput>>>;
}

export interface ToolAssemblyResult {
  supportedTools: ToolSet;
  activeTools: ToolSet;
  experimentalContext: ToolExtensionContext;
  signature: string;
}

export interface ToolDecoratorOptions {
  name?: string;
  description: string;
  inputSchema: MixedInputSchema;
  builtin?: boolean;
  isSupported?: YesImToolDefinition["isSupported"];
  isAllowed?: YesImToolDefinition["isAllowed"];
  buildExtensionContext?: YesImToolDefinition["buildExtensionContext"];
  needsApproval?: AiTool["needsApproval"];
}

export interface ToolDecoratorEntry extends ToolDecoratorOptions {
  methodKey: string;
}
