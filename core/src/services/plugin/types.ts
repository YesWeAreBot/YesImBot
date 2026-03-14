import type { Bot, Schema, Session } from "koishi";

import type {
  Capabilities,
  CapabilityState,
  Percept,
  RoundContext,
  Scenario,
} from "../runtime/contracts";
import type { ActiveSkill } from "../shared/types";
import type { YesImPlugin } from "./plugin";

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

  /** Canonical runtime contract (Phase 54+). Prefer `roundContext` over legacy fields. */
  roundContext?: RoundContext;
  /** Canonical runtime contract (Phase 54+). Prefer `scenario` over `view`. */
  scenario?: Scenario;
  /** Canonical runtime contract (Phase 54+). */
  capabilities?: Capabilities;
  traits?: TraitSignal[];
  skills?: ActiveSkill[];
}

export interface FunctionDefinition {
  name: string;
  description: string;
  type: FunctionType;
  parameters: Schema;
  handler: (params: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>;
  /** Capability keys required for this tool. All keys must be available. */
  requiredCapabilities?: string[];
  /** Strategy used when required capabilities are unavailable. Defaults to "remove". */
  onCapabilityMissing?: "remove" | "hint";
  /** Hidden tools are excluded from getTools() unless explicitly included via skill toolFilter */
  hidden?: boolean;
}

export interface CapabilityResolver {
  readonly platform?: string;
  readonly resolver: (params: {
    session?: Pick<Session, "isDirect" | "quote" | "guildId">;
    scenario?: Scenario;
    bot?: Pick<Bot, "selfId">;
  }) => Record<string, CapabilityState>;
}

export interface PluginMetadata {
  name: string;
  description: string;
  builtin?: boolean;
}

export interface IPluginService {
  registerPlugin(plugin: YesImPlugin): void;
  unregisterPlugin(name: string): void;
  registerCapabilityResolver(resolver: CapabilityResolver): void;
  getCapabilityResolvers(platform?: string): CapabilityResolver["resolver"][];
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
