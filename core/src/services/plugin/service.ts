import { Context, Schema, Service } from "koishi";

import { getCapabilityByKey } from "../runtime/contracts";
import { buildMinimalContext } from "../shared/context-factory";
import { CorePlugin, OnebotPlugin } from "./builtin";
import { YesImPlugin } from "./plugin";
import { schemaToJSONSchema } from "./schema";
import {
  CapabilityResolver,
  FunctionDefinition,
  FunctionType,
  IPluginService,
  ToolExecutionContext,
  ToolResult,
} from "./types";
import { Failed } from "./utils";

export interface PluginServiceConfig {
  defaultTimeout?: number;
}

export const PluginServiceConfigSchema: Schema<PluginServiceConfig> = Schema.object({
  defaultTimeout: Schema.number().default(30000),
});

export class CapabilityUnavailableError extends Error {
  public readonly toolName: string;
  public readonly requiredCapabilities: string[];
  public readonly unsatisfied: Array<{ key: string; reason: string }>;

  constructor(
    toolName: string,
    requiredCapabilities: string[],
    unsatisfied: Array<{ key: string; reason: string }>,
  ) {
    super(
      `Tool "${toolName}" requires capabilities: ${requiredCapabilities.join(", ")}. ` +
        `Unavailable: ${unsatisfied.map((item) => `${item.key} (${item.reason})`).join("; ")}`,
    );
    this.name = "CapabilityUnavailableError";
    this.toolName = toolName;
    this.requiredCapabilities = requiredCapabilities;
    this.unsatisfied = unsatisfied;
  }
}

export class PluginService extends Service<PluginServiceConfig> implements IPluginService {
  static inject = ["yesimbot.hook"];
  private plugins: Map<string, YesImPlugin> = new Map();
  private capabilityResolvers: CapabilityResolver[] = [];

  constructor(ctx: Context, config: PluginServiceConfig) {
    super(ctx, "yesimbot.plugin", true);
    this.config = config;
    this.ctx.plugin(CorePlugin);
    this.ctx.plugin(OnebotPlugin);
    const command = this.ctx.command("yesimbot.plugin", "插件指令集", { authority: 3 });
    command.subcommand(".list", "列出已注册的插件").action(() => {
      const plugins = this.listPlugins();
      if (plugins.length === 0) return "当前没有注册的插件。";
      return `已注册的插件：\n${plugins.map((name) => `- ${name}`).join("\n")}`;
    });

    const toolCmd = this.ctx.command("yesimbot.tool", "工具指令集", { authority: 3 });

    toolCmd
      .subcommand(".list", "列出可用的工具")
      .option("hidden", "--hidden 是否包含隐藏工具", { fallback: false })
      .action(({ session, options }) => {
        if (!session) return "无法获取会话信息。";
        if (!session.platform) return "无法获取平台信息。";
        if (!session.channelId) return "无法获取频道信息。";
        const execCtx = buildMinimalContext({
          platform: session.platform,
          channelId: session.channelId,
          session: session,
          bot: session.bot,
        });
        const tools = this.getTools(execCtx, options?.hidden ?? false);
        if (tools.length === 0) return "当前没有可用的工具。";
        return `可用的工具：\n${tools
          .map((tool) => `- ${tool.function.name}: ${tool.function.description}`)
          .join("\n")}`;
      });

    toolCmd.subcommand(".info <name>", "查看工具详情").action((_, name) => {
      if (!name) return "未指定工具名称";
      const fn = this.getDefinition(name);
      if (!fn) return `未找到工具：${name}`;
      return [
        `工具名称：${fn.name}`,
        `类型：${fn.type}`,
        `描述：${fn.description}`,
        `参数：\n${JSON.stringify(schemaToJSONSchema(fn.parameters), null, 2)}`,
      ].join("\n");
    });

    toolCmd
      .subcommand(".call <name:string> [...params:string]", "调用工具")
      .usage(
        [
          "调用指定的工具并传递参数",
          '参数格式为 "key=value"，多个参数用空格分隔。',
          '如果 value 包含空格，请使用引号将其包裹，例如：key="some value',
        ].join("\n"),
      )
      .example(["yesimbot.tool.call search_web keyword=koishi"].join("\n"))
      .action(async ({ session }, name, ...params) => {
        if (!name) return "错误：未指定要调用的工具名称";
        if (!session) return "无法获取会话信息。";
        if (!session.platform) return "无法获取平台信息。";
        if (!session.channelId) return "无法获取频道信息。";
        const toolCtx = buildMinimalContext({
          platform: session.platform,
          channelId: session.channelId,
          session: session,
          bot: session.bot,
        });

        const parsedParams: Record<string, unknown> = {};
        try {
          const paramString = params?.join(" ") || "";
          const regex = /(\w+)=("([^"]*)"|'([^']*)'|(\S+))/g;
          let match;
          while ((match = regex.exec(paramString)) !== null) {
            const key = match[1];
            const value = match[3] ?? match[4] ?? match[5];
            parsedParams[key] = value;
          }

          if (Object.keys(parsedParams).length === 0 && params?.length > 0) {
            for (const param of params) {
              const parts = param.split("=", 2);
              if (parts.length === 2) {
                parsedParams[parts[0]] = parts[1];
              }
            }
          }
        } catch (error) {
          return `参数解析失败：${(error as Error).message}\n请检查您的参数格式是否正确（key=value）。`;
        }

        const result = await this.invoke(name, parsedParams, toolCtx);

        if (result.success) {
          return [
            `工具调用成功：${name}`,
            result.content ? `返回值：\n${JSON.stringify(result.content, null, 2)}` : "无返回值",
          ].join("\n");
        } else {
          return [
            `工具调用失败：${name}`,
            result.error ? `错误信息：\n${result.error}` : "无错误信息",
          ].join("\n");
        }
      });
  }

  public registerPlugin(plugin: YesImPlugin): void {
    this.plugins.set(plugin.metadata.name, plugin);
    const logger = this.ctx.logger("yesimbot.plugin");
    logger.info(`Registered plugin: ${plugin.metadata.name}`);
  }

  public unregisterPlugin(name: string): void {
    this.plugins.delete(name);
  }

  public registerCapabilityResolver(resolver: CapabilityResolver): void {
    this.capabilityResolvers.push(resolver);
    const logger = this.ctx.logger("yesimbot.plugin");
    logger.info(
      `Registered capability resolver${resolver.platform ? ` for platform: ${resolver.platform}` : " (all platforms)"}`,
    );
  }

  public getCapabilityResolvers(platform?: string): CapabilityResolver["resolver"][] {
    return this.capabilityResolvers
      .filter((resolver) => !resolver.platform || resolver.platform === platform)
      .map((resolver) => resolver.resolver);
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

    if (fn.requiredCapabilities?.length && context?.capabilities) {
      const unsatisfied: Array<{ key: string; reason: string }> = [];

      for (const key of fn.requiredCapabilities) {
        const capability = getCapabilityByKey(context.capabilities, key);
        if (!capability || capability.status !== "available") {
          unsatisfied.push({
            key,
            reason:
              capability?.status === "unavailable"
                ? (capability.reason ?? "unknown")
                : "capability-not-found",
          });
        }
      }

      if (unsatisfied.length > 0) {
        const error = new CapabilityUnavailableError(name, fn.requiredCapabilities, unsatisfied);
        return Failed(error.message);
      }
    }

    const timeout = this.config?.defaultTimeout ?? 30000;
    try {
      return await Promise.race([
        fn.handler(params, context ?? buildMinimalContext({ platform: "", channelId: "" })),
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
