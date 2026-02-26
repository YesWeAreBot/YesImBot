import { Context, Schema, Service } from "koishi";

import { Plugin } from "./base-plugin";
import { CorePlugin, DemoPlugin, OnebotPlugin, SessionInfoPlugin } from "./builtin";
import { schemaToJSONSchema } from "./schema";
import {
  FunctionType,
  type FunctionDefinition,
  type ToolExecutionContext,
  type ToolResult,
} from "./types";
import { Failed } from "./utils";

declare module "koishi" {
  interface Context {
    "yesimbot.plugin": PluginService;
  }
}

export interface PluginServiceConfig {
  defaultTimeout?: number;
}

export const PluginServiceConfigSchema: Schema<PluginServiceConfig> = Schema.object({
  defaultTimeout: Schema.number().default(30000),
});

export class PluginService extends Service<PluginServiceConfig> {
  private plugins: Map<string, Plugin> = new Map();

  constructor(ctx: Context, config: PluginServiceConfig) {
    super(ctx, "yesimbot.plugin", true);
    this.config = config;
    this.register(new CorePlugin(ctx));
    this.register(new SessionInfoPlugin(ctx));
    this.register(new OnebotPlugin(ctx));
    this.register(new DemoPlugin(ctx));
  }

  register(plugin: Plugin): void {
    this.plugins.set(plugin.metadata.name, plugin);
    const logger = this.ctx.logger("yesimbot.plugin");
    logger.info(`Registered plugin: ${plugin.metadata.name}`);
  }

  unregister(name: string): void {
    this.plugins.delete(name);
  }

  private findFunction(name: string): FunctionDefinition | undefined {
    for (const plugin of this.plugins.values()) {
      const fn = plugin.getFunctions().get(name);
      if (fn) return fn;
    }
    return undefined;
  }

  async invoke(
    name: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const fn = this.findFunction(name);
    if (!fn) return Failed(`Function not found: ${name}`);

    const timeout = this.config?.defaultTimeout ?? 30000;
    try {
      return await Promise.race([
        fn.handler(params, context ?? { platform: "", channelId: "" }),
        new Promise<ToolResult>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), timeout),
        ),
      ]);
    } catch (e) {
      return Failed(e instanceof Error ? e.message : String(e));
    }
  }

  getDefinition(name: string): FunctionDefinition | undefined {
    return this.findFunction(name);
  }

  getTools(
    execCtx?: ToolExecutionContext,
    includeHidden = false,
  ): Array<{
    type: "function";
    functionType: FunctionType;
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    const result = [];
    for (const plugin of this.plugins.values()) {
      for (const fn of plugin.getFunctions().values()) {
        if (fn.hidden && !includeHidden) continue;
        if (execCtx && fn.activators?.length) {
          const failed = fn.activators.find((a) => !a.check(execCtx));
          if (failed) {
            if (failed.onFail === "hint") {
              result.push({
                type: "function" as const,
                functionType: fn.type,
                function: {
                  name: fn.name,
                  description: `${fn.description} (unavailable: ${failed.reason ?? "prerequisite not met"})`,
                  parameters: schemaToJSONSchema(fn.parameters),
                },
              });
            }
            continue;
          }
        }
        result.push({
          type: "function" as const,
          functionType: fn.type,
          function: {
            name: fn.name,
            description: fn.description,
            parameters: schemaToJSONSchema(fn.parameters),
          },
        });
      }
    }
    return result;
  }

  listPlugins(): string[] {
    return [...this.plugins.keys()];
  }
}
