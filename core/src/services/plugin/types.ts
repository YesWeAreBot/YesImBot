import type { Bot, Schema, Session } from "koishi";

import type { Percept, Scope } from "../shared/types";

export enum FunctionType {
  Tool = "tool",
  Action = "action",
}

export interface ToolResult<T = unknown> {
  status: "success" | "failed";
  content?: T;
  error?: string;
}

export interface ToolExecutionContext {
  scope: Scope;
  session?: Session;
  bot?: Bot;
  percept?: Percept;
  [key: string]: unknown;
}

export type ActivatorFn = (ctx: ToolExecutionContext) => boolean;

export interface Activator {
  check: ActivatorFn;
  reason?: string;
  onFail?: "remove" | "hint";
}

export interface FunctionDefinition {
  name: string;
  description: string;
  type: FunctionType;
  parameters: Schema;
  handler: (params: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>;
  activators?: Activator[];
}

export interface PluginMetadata {
  name: string;
  description: string;
  builtin?: boolean;
}
