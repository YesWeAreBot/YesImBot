declare module "koishi-plugin-yesimbot/services/plugin" {
  import type { Bot, Context, Schema, Session } from "koishi";

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
  }

  export interface FunctionDefinition {
    name: string;
    description: string;
    type: FunctionType;
    parameters: Schema;
    handler: (params: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>;
    requiredCapabilities?: string[];
    onCapabilityMissing?: "remove" | "hint";
    hidden?: boolean;
  }

  export function defineTool(def: Omit<FunctionDefinition, "type">): MethodDecorator;
  export function defineAction(def: Omit<FunctionDefinition, "type">): MethodDecorator;
  export function withInnerThoughts(enabled?: boolean): MethodDecorator;
  export function Tool(name: string, description: string, params: Schema): MethodDecorator;
  export function Action(name: string, description: string, params: Schema): MethodDecorator;
  export function Metadata(meta: PluginMetadata): ClassDecorator;

  export interface PluginMetadata {
    name: string;
    description: string;
    builtin?: boolean;
    skillPacks?: string[];
  }

  export class YesImPlugin {
    constructor(ctx: Context);
    protected readonly ctx: Context;
  }

  export function jsonSchemaToSchema(schema: Record<string, unknown>): Schema;
  export function schemaToJSONSchema(schema: Schema): Record<string, unknown>;
  export function Success<T>(data?: T): ToolSuccess<T>;
  export function Failed(error: string, metadata?: Record<string, unknown>): ToolFailure;

  export type CapabilityState =
    | {
        status: "available";
        detail?: string;
        limits?: Record<string, unknown>;
        source?: string;
      }
    | {
        status: "unavailable";
        reason: string;
        recoverable?: boolean;
        detail?: string;
        source?: string;
      };

  export interface Capabilities {
    core: Record<string, CapabilityState>;
    extended: Record<string, CapabilityState>;
  }

  export const CAPABILITY_KEYS: {
    readonly MESSAGE_SEND: "message.send";
    readonly MESSAGE_REPLY: "message.reply";
    readonly MESSAGE_DELETE: "message.delete";
    readonly MESSAGE_READ_HISTORY: "message.read_history";
    readonly MESSAGE_DIRECT: "message.direct";
    readonly MEMBER_MODERATE: "member.moderate";
    readonly SOCIAL_ESSENCE: "social.essence";
    readonly SOCIAL_REACTION: "social.reaction";
    readonly PLATFORM_SESSION: "platform.session";
  };

  export function getCapabilityByKey(
    capabilities: Capabilities | undefined,
    key: string,
  ): CapabilityState | undefined;

  export interface CapabilityResolver {
    readonly platform?: string;
    readonly resolver: (params: {
      session?: Pick<Session, "isDirect" | "quote" | "guildId">;
      scenario?: unknown;
      bot?: Pick<Bot, "selfId">;
    }) => Record<string, CapabilityState>;
  }
}
