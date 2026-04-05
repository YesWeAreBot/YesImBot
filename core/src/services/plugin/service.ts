import type { Tool as AiTool, ToolExecutionOptions } from "@ai-sdk/provider-utils";
import type { IPluginService, YesImPlugin } from "@yesimbot/plugin-sdk";
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
  private plugins = new Map<string, YesImPlugin>();

  constructor(ctx: Context, config: PluginServiceConfig = {}) {
    super(ctx, "yesimbot.plugin", false);
    this.config = config;
    this.logger = ctx.logger("plugin");
    this.logger.level = config.debugLevel ?? 2;
  }

  public async install(plugin: YesImPlugin): Promise<void> {
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

  public getToolSet(): Record<string, AiTool> {
    const set: Record<string, AiTool> = {};
    for (const [pluginName, plugin] of this.plugins.entries()) {
      for (const [name, tool] of plugin.getTools().entries()) {
        if (!(name in set)) {
          set[name] = tool;
          continue;
        }

        const prefixedName = `${pluginName}.${name}`;
        set[this.getUniqueToolName(set, prefixedName)] = tool;
      }
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

  private getUniqueToolName(tools: Record<string, AiTool>, baseName: string): string {
    let uniqueName = baseName;
    let suffix = 2;
    while (uniqueName in tools) {
      uniqueName = `${baseName}_${suffix}`;
      suffix++;
    }
    return uniqueName;
  }
}
