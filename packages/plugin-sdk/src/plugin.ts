import type { Tool as AiTool, ToolExecutionOptions } from "@ai-sdk/provider-utils";
import { tool as aiTool } from "@ai-sdk/provider-utils";
import { Context } from "koishi";

import { normalizeInputSchema } from "./schema";
import { TOOL_DECORATOR_KEY, ToolDecoratorEntry } from "./tools";
import {
  ResponseContext,
  ToolCatalog,
  ToolEntry,
  ToolSelection,
  RegisteredToolDefinition,
  ToolRuntime,
} from "./tools/types";

export interface CompileToolsRequest<THostInput = unknown> {
  runtime: ToolRuntime;
  hostInput: THostInput;
  scope?: string;
  sendMessageTool: AiTool;
}

export interface BuildResponseContextRequest<THostInput = unknown> {
  runtime: ToolRuntime;
  hostInput: THostInput;
  scope?: string;
  catalog: ToolCatalog;
}

export interface SelectToolsRequest {
  runtime: ToolRuntime;
  scope?: string;
  catalog: ToolCatalog;
  responseContext: ResponseContext;
}

export interface ToolInvoke<THostInput = unknown> {
  name: string;
  input: unknown;
  runtime: ToolRuntime;
  hostInput: THostInput;
  scope?: string;
  options?: Partial<ToolExecutionOptions>;
}

export interface IPluginService {
  install(plugin: YesImPlugin, options?: { scope?: string }): Promise<void>;
  remove(name: string, options?: { scope?: string }): void;
  list(): string[];
  getToolDefinitions(scope?: string): RegisteredToolDefinition[];
  compileTools(request: CompileToolsRequest): Promise<ToolCatalog>;
  buildResponseContext<THostInput = unknown>(
    request: BuildResponseContextRequest<THostInput>,
  ): Promise<ResponseContext>;
  selectTools(request: SelectToolsRequest): Promise<ToolSelection>;
  invoke(invoke: ToolInvoke): Promise<unknown>;
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
  private lifecycleInitialized = false;
  private lifecycleInitializeTask: Promise<void> | null = null;

  constructor(ctx: Context) {
    this.ctx = ctx;
    const meta = Reflect.get(this, METADATA_KEY) as PluginMetadata | undefined;
    if (!meta) {
      throw new Error("Plugin class must be decorated with @Metadata");
    }
    this.metadata = meta;
    this.registerDecoratedTools();

    ctx.on("ready", async () => {
      await Promise.resolve();

      if (this.lifecycleInitialized) {
        return;
      }

      if (this.lifecycleInitializeTask) {
        await this.lifecycleInitializeTask;
        return;
      }

      this.lifecycleInitializeTask = (async () => {
        await this.init();
        this.lifecycleInitialized = true;

        const pluginService = ctx["yesimbot.plugin"] as IPluginService | undefined;
        if (!pluginService) {
          return;
        }

        await pluginService.install(this);
      })();

      try {
        await this.lifecycleInitializeTask;
      } finally {
        this.lifecycleInitializeTask = null;
      }
    });

    ctx.on("dispose", async () => {
      const pluginService = ctx["yesimbot.plugin"] as IPluginService | undefined;
      pluginService?.remove(this.metadata.name);
      await this.cleanup();
    });
  }

  async init(): Promise<void> {}

  async cleanup(): Promise<void> {}

  public getTools(): Map<string, AiTool> {
    return new Map(
      this.getToolDefinitions().map((definition) => [definition.name, definition.tool]),
    );
  }

  public getToolDefinitions(): RegisteredToolDefinition[] {
    return [...this.toolDefinitions.values()];
  }

  protected registerTool(definition: ToolEntry): void {
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
          match: entry.match,
          enable: entry.enable,
          extendResponse: entry.extendResponse,
          execute: async (input, options) =>
            await (handler as (input: unknown, options: ToolExecutionOptions) => unknown).call(
              this,
              input,
              options,
            ),
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
