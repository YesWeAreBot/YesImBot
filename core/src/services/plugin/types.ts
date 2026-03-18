import type { Bot, Schema, Session } from "koishi";

import type { YesImPlugin } from "./plugin";

// ---- Shared Types ----

export type TriggerType =
  | "mention"
  | "reply"
  | "keyword"
  | "random"
  | "direct"
  | "timer"
  | "internal";

export type ChannelKey = { platform: string; channelId: string };

export interface Percept {
  id: string;
  traceId: string;
  type: TriggerType;
  platform: string;
  channelId: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface TraitSignal {
  dimension: string;
  value: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

export enum FunctionType {
  Tool = "tool",
  Action = "action",
}

export interface ToolResult<T = unknown> {
  success: boolean;
  status?: "success" | "failed" | string;
  content?: T;
  error?: string;
}

export interface ToolExecutionContext {
  platform: string;
  channelId: string;
  session?: Session;
  bot?: Bot;
  percept?: Percept;
  view?: import("../horizon/types").HorizonView;
  traits?: TraitSignal[];
  skills?: import("../shared/types").ActiveSkill[];
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
  /** Hidden tools are excluded from getTools() unless explicitly included via skill toolFilter */
  hidden?: boolean;
}

export interface PluginMetadata {
  name: string;
  description: string;
  builtin?: boolean;
}

export interface IPluginService {
  registerPlugin(plugin: YesImPlugin): void;
  unregisterPlugin(name: string): void;
  getDefinition(name: string): FunctionDefinition | undefined;
  getTools(
    execCtx?: ToolExecutionContext,
    includeHidden?: boolean,
  ): Array<{
    type: "function";
    functionType: FunctionType;
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
  listPlugins(): string[];
}
