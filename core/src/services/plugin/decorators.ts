import { Schema } from "koishi";

import {
  FunctionType,
  type FunctionContext,
  type FunctionDefinition,
  type PluginMetadata,
  type ToolResult,
} from "./types";

interface DecoratorOpts {
  name: string;
  description: string;
  parameters: Schema;
}

export interface StaticEntry extends DecoratorOpts {
  type: FunctionType;
  methodKey: string;
}

export function Metadata(meta: PluginMetadata): ClassDecorator {
  return (target) => {
    (target as unknown as { prototype: Record<string, unknown> }).prototype.__pluginMetadata = meta;
  };
}

export function Tool(opts: DecoratorOpts): MethodDecorator {
  return (target, propertyKey) => {
    const proto = target as Record<string, unknown>;
    if (!proto.__staticTools) proto.__staticTools = [];
    (proto.__staticTools as StaticEntry[]).push({
      ...opts,
      type: FunctionType.Tool,
      methodKey: String(propertyKey),
    });
  };
}

export function Action(opts: DecoratorOpts): MethodDecorator {
  return (target, propertyKey) => {
    const proto = target as Record<string, unknown>;
    if (!proto.__staticActions) proto.__staticActions = [];
    (proto.__staticActions as StaticEntry[]).push({
      ...opts,
      type: FunctionType.Action,
      methodKey: String(propertyKey),
    });
  };
}

export function defineTool(
  name: string,
  description: string,
  parameters: Schema,
  handler: (params: Record<string, unknown>, ctx: FunctionContext) => Promise<ToolResult>,
): FunctionDefinition {
  return { name, description, type: FunctionType.Tool, parameters, handler };
}

export function defineAction(
  name: string,
  description: string,
  parameters: Schema,
  handler: (params: Record<string, unknown>, ctx: FunctionContext) => Promise<ToolResult>,
): FunctionDefinition {
  return { name, description, type: FunctionType.Action, parameters, handler };
}

export function withInnerThoughts(params: Record<string, Schema>): Schema {
  return Schema.object({
    inner_thoughts: Schema.string().description("Deep inner monologue private to you only."),
    ...params,
  });
}
