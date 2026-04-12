import type { Tool as AiTool, ToolExecutionOptions } from "@ai-sdk/provider-utils";
import { YesImPlugin } from "@yesimbot/plugin-sdk";
import type {
  IPluginService,
  RegisteredToolDefinition,
  ToolAssemblyRequest,
  ToolInvocationRequest,
  ToolRuntime,
  ToolSource,
} from "@yesimbot/plugin-sdk";
import { Context, Service } from "koishi";

import {
  buildToolAssembly,
  type ToolAssemblyContextFactory,
  type ToolAssemblyResult,
} from "../session/runtime/tool-assembly";

export interface PluginServiceConfig {
  debugLevel?: number;
}

export class PluginService extends Service<PluginServiceConfig> implements IPluginService {
  private static readonly RESERVED_TOOL_NAMES = new Set(["send_message"]);
  private plugins = new Map<string, Map<string, YesImPlugin>>();

  constructor(ctx: Context, config: PluginServiceConfig = {}) {
    super(ctx, "yesimbot.plugin", false);
    this.config = config;
    this.logger = ctx.logger("plugin");
    this.logger.level = config.debugLevel ?? 2;
  }

  public async install(plugin: YesImPlugin, options?: { scope?: string }): Promise<void> {
    const scope = options?.scope ?? "global";
    const initializablePlugin = plugin as YesImPlugin & { init?: () => Promise<void> };
    await initializablePlugin.init?.();
    this.assertPluginToolDefinitions(plugin, scope);
    let scopedPlugins = this.plugins.get(scope);
    if (!scopedPlugins) {
      scopedPlugins = new Map();
      this.plugins.set(scope, scopedPlugins);
    }
    scopedPlugins.set(plugin.metadata.name, plugin);
    this.logger.info(`Plugin installed: ${plugin.metadata.name} (scope=${scope})`);
  }

  public remove(name: string, options?: { scope?: string }): void {
    const scope = options?.scope ?? "global";
    this.plugins.get(scope)?.delete(name);
    if (this.plugins.get(scope)?.size === 0) {
      this.plugins.delete(scope);
    }
    this.logger.info(`Plugin removed: ${name} (scope=${scope})`);
  }

  public list(): string[] {
    return [...(this.plugins.get("global")?.keys() ?? [])];
  }

  public getToolDefinitions(): RegisteredToolDefinition[] {
    return this.collectToolDefinitions();
  }

  public getToolSet(): Record<string, AiTool> {
    return Object.fromEntries(this.getToolDefinitions().map((d) => [d.name, d.tool]));
  }

  public async assembleTools<THostInput = unknown>(
    request: ToolAssemblyRequest<THostInput>,
  ): Promise<ToolAssemblyResult> {
    const installedDefinitions = this.collectToolDefinitions(request.scope);
    const sourceDefinitions = this.collectSourceToolDefinitions(request.sources);
    const additionalDefinitions = request.additionalToolDefinitions ?? [];
    const derivedContextFactories = this.buildDefinitionContextFactories<THostInput>([
      ...installedDefinitions,
      ...sourceDefinitions,
      ...additionalDefinitions,
    ]);

    this.assertToolDefinitions([
      ...installedDefinitions,
      ...sourceDefinitions,
      ...additionalDefinitions,
    ]);

    return buildToolAssembly({
      runtime: request.runtime,
      hostInput: request.hostInput,
      pluginToolDefinitions: installedDefinitions,
      workspaceToolDefinitions: [...sourceDefinitions, ...additionalDefinitions],
      toolSettings: request.toolSettings,
      contextFactories: this.mergeContextFactories(
        derivedContextFactories,
        request.contextFactories,
        request.sources,
      ),
      sendMessageTool: request.sendMessageTool,
    });
  }

  public async invoke(request: ToolInvocationRequest): Promise<unknown>;
  public async invoke(
    name: string,
    input: unknown,
    options?: Partial<ToolExecutionOptions>,
  ): Promise<unknown>;
  public async invoke(
    nameOrRequest: string | ToolInvocationRequest,
    input?: unknown,
    options?: Partial<ToolExecutionOptions>,
  ): Promise<unknown> {
    const request = this.normalizeInvocationRequest(nameOrRequest, input, options);
    const assembly = await this.assembleTools(request);
    const tool = assembly.activeTools[request.name];
    if (!tool) {
      if (request.name in assembly.supportedTools) {
        throw new Error(`Tool is not active: ${request.name}`);
      }

      throw new Error(`Tool not found: ${request.name}`);
    }

    if (!tool.execute) throw new Error(`Tool is not executable: ${request.name}`);
    return tool.execute(request.input as never, {
      toolCallId: request.options?.toolCallId ?? `manual:${request.name}`,
      messages: request.options?.messages ?? [],
      abortSignal: request.options?.abortSignal,
      experimental_context: assembly.experimentalContext,
    });
  }

  private assertPluginToolDefinitions(plugin: YesImPlugin, scope?: string): void {
    this.assertToolDefinitions([
      ...this.collectToolDefinitions(scope),
      ...plugin.getToolDefinitions(),
    ]);
  }

  private buildDefinitionContextFactories<THostInput = unknown>(
    definitions: RegisteredToolDefinition[],
  ): Partial<Record<string, ToolAssemblyContextFactory<THostInput>>> | undefined {
    const grouped = new Map<string, Array<NonNullable<RegisteredToolDefinition["definition"]["buildExtensionContext"]>>>();

    for (const definition of definitions) {
      const factory = definition.definition.buildExtensionContext;
      if (!factory) continue;
      const existing = grouped.get(definition.pluginName) ?? [];
      existing.push(factory);
      grouped.set(definition.pluginName, existing);
    }

    if (grouped.size === 0) {
      return undefined;
    }

    return Object.fromEntries(
      [...grouped.entries()].map(([pluginName, factories]) => [
        pluginName,
        (hostInput: THostInput, runtime: ToolRuntime) => {
          const merged: Record<string, unknown> = {};

          for (const factory of factories) {
            const value = factory(hostInput, runtime);
            if (value !== undefined) {
              Object.assign(merged, value);
            }
          }

          return Object.keys(merged).length > 0 ? merged : undefined;
        },
      ]),
    ) as Partial<Record<string, ToolAssemblyContextFactory<THostInput>>>;
  }

  private collectToolDefinitions(scope?: string): RegisteredToolDefinition[] {
    const definitions: RegisteredToolDefinition[] = [];
    this.pushPluginDefinitions("global", definitions);
    if (scope && scope !== "global") {
      this.pushPluginDefinitions(scope, definitions);
    }
    this.assertToolDefinitions(definitions);
    return definitions;
  }

  private pushPluginDefinitions(scope: string, out: RegisteredToolDefinition[]): void {
    for (const plugin of this.plugins.get(scope)?.values() ?? []) {
      out.push(...plugin.getToolDefinitions());
    }
  }

  private collectSourceToolDefinitions<THostInput = unknown>(
    sources: ToolSource<THostInput>[] | undefined,
  ): RegisteredToolDefinition[] {
    return sources?.flatMap((source) => source.toolDefinitions) ?? [];
  }

  private mergeContextFactories<THostInput = unknown>(
    derivedFactories: Partial<Record<string, ToolAssemblyContextFactory<THostInput>>> | undefined,
    requestFactories: ToolAssemblyRequest<THostInput>["contextFactories"],
    sources: ToolSource<THostInput>[] | undefined,
  ): Partial<Record<string, ToolAssemblyContextFactory<THostInput>>> | undefined {
    const sourceFactories = Object.assign(
      {},
      ...(sources?.map((source) => source.contextFactories ?? {}) ?? []),
    ) as Partial<Record<string, ToolAssemblyContextFactory<THostInput>>>;
    const merged = {
      ...derivedFactories,
      ...sourceFactories,
      ...requestFactories,
    };

    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  private normalizeInvocationRequest(
    nameOrRequest: string | ToolInvocationRequest,
    input?: unknown,
    options?: Partial<ToolExecutionOptions>,
  ): ToolInvocationRequest {
    if (typeof nameOrRequest !== "string") {
      return {
        ...nameOrRequest,
        toolSettings: {
          ...nameOrRequest.toolSettings,
          enabled: [...new Set([...nameOrRequest.toolSettings?.enabled ?? [], nameOrRequest.name])],
        },
      };
    }

    return {
      name: nameOrRequest,
      input,
      options,
      runtime: this.createDirectInvokeRuntime(),
      hostInput: {},
      toolSettings: {
        enabled: [nameOrRequest],
      },
    };
  }

  private createDirectInvokeRuntime(): ToolRuntime {
    return {
      channelKey: "manual:direct",
      platform: "manual",
      channelId: "direct",
      modelId: "manual:invoke",
      basePath: this.ctx.baseDir,
      turn: {
        messageId: "manual:invoke",
        timestamp: Date.now(),
        isDirect: true,
        atSelf: true,
        isReplyToBot: false,
      },
    };
  }

  private ensureEnabledTool(name: string, enabledTools: string[]): string[] {
    return [...new Set([...enabledTools, name])];
  }

  private assertToolDefinitions(definitions: RegisteredToolDefinition[]): void {
    const seen = new Map<string, string>();

    for (const definition of definitions) {
      this.assertToolDefinition(definition, definition.pluginName, seen);
    }
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
