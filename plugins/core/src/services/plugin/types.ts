import type { Schema, Session } from "koishi";

import type { HorizonView, Percept } from "../horizon/types";

export enum FunctionType {
  Tool = "tool",
  Action = "action",
}

export interface ToolResult<T = unknown> {
  status: "success" | "failed";
  result?: T;
  error?: string;
}

export interface FunctionContext {
  session?: Session;
  view?: HorizonView;
  percept?: Percept;
  [key: string]: unknown;
}

export interface FunctionDefinition {
  name: string;
  description: string;
  type: FunctionType;
  parameters: Schema;
  handler: (params: Record<string, unknown>, ctx: FunctionContext) => Promise<ToolResult>;
}

export interface PluginMetadata {
  name: string;
  description: string;
  builtin?: boolean;
}

export interface PluginServiceConfig {
  defaultTimeout?: number;
}
