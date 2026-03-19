import type { Bot, Schema, Session } from "koishi";

import type {
  Capabilities,
  CapabilityState,
  Percept,
  RoundContext,
  Scenario,
} from "../../runtime/contracts";
import type { ActiveSkill } from "../../shared/types";
import type { HorizonView } from "../horizon/types";
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

export interface ToolSuccess<T = unknown> {
  ok: true;
  data: T;
  metadata?: Record<string, unknown>;
}

export interface ToolFailure {
  ok: false;
  error: string;
  metadata?: Record<string, unknown>;
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

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
}

export interface RuntimeToolExecutionContext extends ToolExecutionContext {
  traits?: TraitSignal[];
  skills?: ActiveSkill[];
  view?: HorizonView;
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
  skillPacks?: string[];
}

export type PluginMountState = "mounting" | "mounted";

export interface PluginMountRecord {
  name: string;
  plugin: YesImPlugin;
  state: PluginMountState;
  mountedAt: Date;
  disposers: Array<() => void>;
}

export interface RoundFunctionEntry {
  type: "function";
  functionType: FunctionType;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface RoundActionCall {
  name: string;
  params?: Record<string, unknown>;
}

export interface RoundActionResultEntry {
  id: number;
  name: string;
  success: boolean;
  status?: string;
  result?: unknown;
  error?: string;
}

export interface RoundActionExecutionResult {
  toolResults: RoundActionResultEntry[];
  hasToolCalls: boolean;
  hasActionCalls: boolean;
}

export type RoundUnavailableReason = "capability-missing" | "tool-not-installed";

export interface RoundUnavailableEntry {
  name: string;
  reason: RoundUnavailableReason;
  detail: string;
  functionType?: FunctionType;
  missingCapabilities?: string[];
}

export interface RoundAvailability {
  visible: RoundFunctionEntry[];
  unavailable: RoundUnavailableEntry[];
}

export interface IPluginService {
  mountPlugin(plugin: YesImPlugin): Promise<void>;
  unmountPlugin(name: string): void;
  registerPlugin(plugin: YesImPlugin): void;
  unregisterPlugin(name: string): void;
  registerCapabilityResolver(resolver: CapabilityResolver): void;
  getCapabilityResolvers(platform?: string): CapabilityResolver["resolver"][];
  getDefinition(name: string): FunctionDefinition | undefined;
  getRoundAvailability(execCtx?: ToolExecutionContext, allowedTools?: string[]): RoundAvailability;
  executeRoundActions(
    actions: RoundActionCall[],
    execCtx: ToolExecutionContext,
    traceId: string,
    maxResultLength: number,
  ): Promise<RoundActionExecutionResult>;
  getTools(
    execCtx?: ToolExecutionContext,
    includeHidden?: boolean,
  ): RoundFunctionEntry[];
  listPlugins(): string[];
}
