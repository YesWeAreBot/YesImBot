import type { Tool as AiTool, ToolExecutionOptions } from "@ai-sdk/provider-utils";
import { tool as aiTool } from "@ai-sdk/provider-utils";
import type { ToolSet } from "ai";
import { Context } from "koishi";

import { normalizeInputSchema } from "./schema";
import { TOOL_DECORATOR_KEY, ToolDecoratorEntry } from "./tools";
import {
  RegisteredToolDefinition,
  ToolAssemblyContextFactory,
  ToolAssemblyResult,
  ToolAssemblySettings,
  ToolSource,
  ToolRuntime,
  YesImToolDefinition,
} from "./tools/types";

export interface ToolAssemblyRequest<THostInput = unknown> {
  runtime: ToolRuntime;
  hostInput: THostInput;
  scope?: string;
  toolSettings?: ToolAssemblySettings;
  contextFactories?: Partial<Record<string, ToolAssemblyContextFactory<THostInput>>>;
  sources?: ToolSource<THostInput>[];
  additionalToolDefinitions?: RegisteredToolDefinition[];
  sendMessageTool?: ToolSet["send_message"];
}

export interface ToolInvocationRequest<
  THostInput = unknown,
> extends ToolAssemblyRequest<THostInput> {
  name: string;
  input: unknown;
  options?: Partial<ToolExecutionOptions>;
}

export interface IPluginService {
  install(plugin: YesImPlugin, options?: { scope?: string }): Promise<void>;
  remove(name: string, options?: { scope?: string }): void;
  list(): string[];
  getToolDefinitions(): RegisteredToolDefinition[];
  getToolSet(): Record<string, AiTool>;
  assembleTools(request: ToolAssemblyRequest): Promise<ToolAssemblyResult>;
  invoke(request: ToolInvocationRequest): Promise<unknown>;
  invoke(name: string, input: unknown, options?: Partial<ToolExecutionOptions>): Promise<unknown>;
}

declare module "koishi" {
  interface Context {
    "yesimbot.plugin"?: IPluginService;
  }
}

export interface PluginMetadata {
  name: string;
  description: string;
  builtin?: boolean;
  managedLifecycle?: boolean;
}

const METADATA_KEY = Symbol("yesimbot.plugin.metadata");

export function Metadata(meta: PluginMetadata): ClassDecorator {
  return (target) => {
    Reflect.defineProperty(target.prototype, METADATA_KEY, {
      value: meta,
      enumerable: false,
    });
  };
}

export class YesImPlugin {
  public readonly ctx: Context;
  public readonly metadata: PluginMetadata;
  protected toolDefinitions: Map<string, RegisteredToolDefinition> = new Map();

  constructor(ctx: Context) {
    this.ctx = ctx;
    const meta = Reflect.get(this, METADATA_KEY) as PluginMetadata | undefined;
    if (!meta) {
      throw new Error("Plugin class must be decorated with @Metadata");
    }
    this.metadata = meta;
    this.registerDecoratedTools();

    if (this.metadata.managedLifecycle !== true) {
      ctx.on("ready", async () => {
        const pluginService = ctx["yesimbot.plugin"] as IPluginService | undefined;
        if (!pluginService) return;
        await pluginService.install(this);
      });

      ctx.on("dispose", async () => {
        const pluginService = ctx["yesimbot.plugin"] as IPluginService | undefined;
        pluginService?.remove(this.metadata.name);
      });
    }
  }

  public getTools(): Map<string, AiTool> {
    return new Map(
      this.getToolDefinitions().map((definition) => [definition.name, definition.tool]),
    );
  }

  public getToolDefinitions(): RegisteredToolDefinition[] {
    return [...this.toolDefinitions.values()];
  }

  protected registerTool(definition: YesImToolDefinition): void {
    const inputSchema = normalizeInputSchema(definition.inputSchema);
    const tool = aiTool({
      description: definition.description,
      inputSchema,
      execute: definition.execute,
    });
    this.registerToolDefinition({
      pluginName: this.metadata.name,
      name: definition.name,
      definition,
      tool,
    });
  }

  private registerDecoratedTools(): void {
    const entries = collectToolEntries(this);
    for (const entry of entries) {
      const handler = (this as Record<string, unknown>)[entry.methodKey];
      if (typeof handler !== "function") {
        throw new Error(`Tool handler not found: ${entry.methodKey}`);
      }
      const name = this.resolveToolName(entry.name ?? entry.methodKey);
      const inputSchema = normalizeInputSchema(entry.inputSchema);
      const tool = aiTool({
        description: entry.description,
        inputSchema,
        needsApproval: entry.needsApproval,
        execute: async (input, options) =>
          await (
            handler as (input: unknown, options: ToolExecutionOptions) => unknown | Promise<unknown>
          ).call(this, input, options),
      });
      this.registerToolDefinition({
        pluginName: this.metadata.name,
        name,
        definition: {
          name,
          description: entry.description,
          inputSchema: entry.inputSchema,
          builtin: entry.builtin,
          isSupported: entry.isSupported,
          isAllowed: entry.isAllowed,
          buildExtensionContext: entry.buildExtensionContext,
          execute: async (input, options) =>
            await (
              handler as (
                input: unknown,
                options: ToolExecutionOptions,
              ) => unknown | Promise<unknown>
            ).call(this, input, options),
        },
        tool,
      });
    }
  }

  private resolveToolName(name: string): string {
    return name;
  }

  protected registerToolDefinition(definition: RegisteredToolDefinition): void {
    if (this.toolDefinitions.has(definition.name)) {
      throw new Error(
        `Plugin ${this.metadata.name} already registered tool definition: ${definition.name}`,
      );
    }
    this.toolDefinitions.set(definition.name, definition);
  }
}

function collectToolEntries(instance: YesImPlugin): ToolDecoratorEntry[] {
  const entries: ToolDecoratorEntry[] = [];
  let proto = Object.getPrototypeOf(instance);
  while (proto && proto !== YesImPlugin.prototype) {
    const list = proto[TOOL_DECORATOR_KEY] as ToolDecoratorEntry[] | undefined;
    if (list) {
      entries.push(...list);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return entries;
}
