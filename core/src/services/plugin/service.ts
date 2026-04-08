import type { Tool as AiTool, ToolExecutionOptions } from "@ai-sdk/provider-utils";
import type { IPluginService, RegisteredToolDefinition, YesImPlugin } from "@yesimbot/plugin-sdk";
import { Context, Service } from "koishi";

declare module "koishi" {
  interface Context {
    "yesimbot.plugin"?: IPluginService;
  }
}

export interface PluginServiceConfig {
  debugLevel?: number;
}

export class PluginService extends Service<PluginServiceConfig> implements IPluginService {
  private static readonly RESERVED_TOOL_NAMES = new Set(["send_message"]);
  private plugins = new Map<string, YesImPlugin>();

  constructor(ctx: Context, config: PluginServiceConfig = {}) {
    super(ctx, "yesimbot.plugin", false);
    this.config = config;
    this.logger = ctx.logger("plugin");
    this.logger.level = config.debugLevel ?? 2;
  }

  public async install(plugin: YesImPlugin): Promise<void> {
    this.assertPluginToolDefinitions(plugin);
    this.plugins.set(plugin.metadata.name, plugin);
    this.logger.info(`Plugin installed: ${plugin.metadata.name}`);
  }

  public remove(name: string): void {
    this.plugins.delete(name);
    this.logger.info(`Plugin removed: ${name}`);
  }

  public list(): string[] {
    return [...this.plugins.keys()];
  }

  public getToolDefinitions(): RegisteredToolDefinition[] {
    return this.collectToolDefinitions();
  }

  public getToolSet(): Record<string, AiTool> {
    const set: Record<string, AiTool> = {};
    for (const definition of this.getToolDefinitions()) {
      set[definition.name] = definition.tool;
    }
    return set;
  }

  public async invoke(
    name: string,
    input: unknown,
    options?: Partial<ToolExecutionOptions>,
  ): Promise<unknown> {
    const tool = this.getToolSet()[name];
    if (!tool) throw new Error(`Tool not found: ${name}`);
    if (!tool.execute) throw new Error(`Tool is not executable: ${name}`);
    return tool.execute(input as never, {
      toolCallId: options?.toolCallId ?? `manual:${name}`,
      messages: options?.messages ?? [],
      abortSignal: options?.abortSignal,
      experimental_context: options?.experimental_context,
    });
  }

  private assertPluginToolDefinitions(plugin: YesImPlugin): void {
    const seen = new Map<string, string>();

    for (const [pluginName, existingPlugin] of this.plugins.entries()) {
      for (const definition of existingPlugin.getToolDefinitions()) {
        this.assertToolDefinition(definition, pluginName, seen);
      }
    }

    for (const definition of plugin.getToolDefinitions()) {
      this.assertToolDefinition(definition, plugin.metadata.name, seen);
    }
  }

  private collectToolDefinitions(): RegisteredToolDefinition[] {
    const definitions: RegisteredToolDefinition[] = [];
    const seen = new Map<string, string>();

    for (const [pluginName, plugin] of this.plugins.entries()) {
      for (const definition of plugin.getToolDefinitions()) {
        this.assertToolDefinition(definition, pluginName, seen);
        definitions.push(definition);
      }
    }

    return definitions;
  }

  private assertToolDefinition(
    definition: RegisteredToolDefinition,
    pluginName: string,
    seen: Map<string, string>,
  ): void {
    if (PluginService.RESERVED_TOOL_NAMES.has(definition.name)) {
      throw new Error(
        `Tool name '${definition.name}' is reserved and cannot be registered by ${pluginName}`,
      );
    }

    const previousPlugin = seen.get(definition.name);
    if (previousPlugin) {
      throw new Error(
        `Duplicate tool name '${definition.name}' registered by ${previousPlugin} and ${pluginName}`,
      );
    }

    seen.set(definition.name, pluginName);
  }
}
