import type { Tool as AiTool, ToolExecutionOptions } from "@ai-sdk/provider-utils";
import type { IPluginService, YesImPlugin } from "@yesimbot/plugin-sdk";
import { Context, Service } from "koishi";

export interface PluginServiceConfig {
  debugLevel?: number;
}

export class PluginService extends Service<PluginServiceConfig> implements IPluginService {
  private plugins: Map<string, YesImPlugin> = new Map();

  constructor(ctx: Context, config: PluginServiceConfig = {}) {
    super(ctx, "yesimbot.plugin", true);
    this.config = config;
    this.logger = ctx.logger("yesimbot.plugin");
    this.logger.level = config.debugLevel ?? 2;
  }

  public async install(plugin: YesImPlugin): Promise<void> {
    this.plugins.set(plugin.metadata.name, plugin);
  }

  public remove(name: string): void {
    this.plugins.delete(name);
  }

  public list(): string[] {
    return [...this.plugins.keys()];
  }

  public getToolSet(): Record<string, AiTool> {
    const set: Record<string, AiTool> = {};
    for (const plugin of this.plugins.values()) {
      for (const [name, tool] of plugin.getTools().entries()) {
        set[name] = tool;
      }
    }
    return set;
  }

  public async invoke(
    name: string,
    input: unknown,
    options?: Partial<ToolExecutionOptions>,
  ): Promise<unknown> {
    const tool = this.getToolByName(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    if (!tool.execute) throw new Error(`Tool is not executable: ${name}`);
    return tool.execute(input as never, {
      toolCallId: options?.toolCallId ?? `manual:${name}`,
      messages: options?.messages ?? [],
      abortSignal: options?.abortSignal,
      experimental_context: options?.experimental_context,
    });
  }

  private getToolByName(name: string): AiTool | undefined {
    for (const plugin of this.plugins.values()) {
      const tool = plugin.getTools().get(name);
      if (tool) return tool;
    }
    return undefined;
  }
}
