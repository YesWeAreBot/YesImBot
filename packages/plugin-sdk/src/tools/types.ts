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

export interface ResponseContext {
  [pluginName: string]: Record<string, unknown>;
}

export interface ToolMatchContext {
  runtime: ToolRuntime;
}

export interface ToolEnableContext extends ToolMatchContext {
  responseContext: ResponseContext;
}

export interface ToolEntry<INPUT = unknown, OUTPUT = unknown> {
  name: string;
  description: string;
  inputSchema: MixedInputSchema;
  builtin?: boolean;
  match?: (context: ToolMatchContext) => boolean;
  enable?: (context: ToolEnableContext) => boolean;
  execute: (input: INPUT, options: ToolExecutionOptions) => PromiseLike<OUTPUT> | OUTPUT;
}

export interface RegisteredToolDefinition<INPUT = unknown, OUTPUT = unknown> {
  pluginName: string;
  name: string;
  definition: ToolEntry<INPUT, OUTPUT>;
  tool: AiTool;
}

export interface ToolHandle<INPUT = unknown, OUTPUT = unknown> {
  pluginName: string;
  name: string;
  definition: ToolEntry<INPUT, OUTPUT>;
  tool: AiTool;
}

export interface ToolCatalog {
  tools: ToolSet;
  handles: Record<string, ToolHandle>;
  signature: string;
}

export interface ToolSelection {
  activeTools: ToolSet;
  activeToolNames: string[];
  responseContext: ResponseContext;
}

export interface ToolDecoratorOptions {
  name?: string;
  description: string;
  inputSchema: MixedInputSchema;
  builtin?: boolean;
  match?: ToolEntry["match"];
  enable?: ToolEntry["enable"];
  needsApproval?: AiTool["needsApproval"];
}

export interface ToolDecoratorEntry extends ToolDecoratorOptions {
  methodKey: string;
}

export interface InstructionProvider {
  name: string;
  shouldApply?(context: unknown): boolean | Promise<boolean>;
  collect(context: unknown): unknown[] | Promise<unknown[]>;
}
