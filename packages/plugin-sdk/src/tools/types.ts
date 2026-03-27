import type { FlexibleSchema, ToolExecutionOptions } from "@ai-sdk/provider-utils";
import type { Tool as AiTool } from "@ai-sdk/provider-utils";
import type { JSONSchema4 } from "json-schema";
import type { Schema } from "koishi";

export type MixedInputSchema = Schema | JSONSchema4 | FlexibleSchema<unknown>;

export interface YesImToolDefinition<INPUT = unknown, OUTPUT = unknown> {
  name: string;
  description: string;
  inputSchema: MixedInputSchema;
  execute: (input: INPUT, options: ToolExecutionOptions) => PromiseLike<OUTPUT> | OUTPUT;
}

export interface ToolDecoratorOptions {
  name?: string;
  description: string;
  inputSchema: MixedInputSchema;
  needsApproval?: AiTool["needsApproval"];
}

export interface ToolDecoratorEntry extends ToolDecoratorOptions {
  methodKey: string;
}
