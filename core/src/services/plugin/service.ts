import type { Tool as AiTool } from "@ai-sdk/provider-utils";
import { YesImPlugin } from "@yesimbot/plugin-sdk";
import type {
  BuildResponseContextRequest,
  CompileToolsRequest,
  IPluginService,
  RegisteredToolDefinition,
  ResponseContext,
  SelectToolsRequest,
  ToolCatalog,
  ToolHandle,
  ToolInvoke,
  ToolSelection,
} from "@yesimbot/plugin-sdk";
import type { ToolSet } from "ai";
import { Context, Service } from "koishi";

type InstructionContributorLike = {
  name: string;
  collect: (context: unknown) => Promise<unknown[]> | unknown[];
};

export interface PluginServiceConfig {
  debugLevel?: number;
}

type ChannelToolState = {
  channelKey: string;
  scopeKey: string;
  signature: string;
  catalog: ToolCatalog;
};

export class PluginService extends Service<PluginServiceConfig> implements IPluginService {
  private static readonly RESERVED_TOOL_NAMES = new Set(["send_message"]);
  private plugins = new Map<string, Map<string, YesImPlugin>>();
  private readonly channelTools = new Map<string, ChannelToolState>();
  private readonly scopeIndex = new Map<string, Set<string>>();

  constructor(ctx: Context, config: PluginServiceConfig = {}) {
    super(ctx, "yesimbot.plugin", false);
    this.config = config;
    this.logger = ctx.logger("plugin");
    this.logger.level = config.debugLevel ?? 2;
  }

  public async install(plugin: YesImPlugin, options?: { scope?: string }): Promise<void> {
    const scope = this.normalizeScopeKey(options?.scope);
    this.assertPluginToolDefinitions(plugin, scope);
    let scopedPlugins = this.plugins.get(scope);
    if (!scopedPlugins) {
      scopedPlugins = new Map();
      this.plugins.set(scope, scopedPlugins);
    }
    scopedPlugins.set(plugin.metadata.name, plugin);
    this.refreshProviderVisibility(options?.scope);
    this.logger.info(`Plugin installed: ${plugin.metadata.name} (scope=${scope})`);
  }

  public remove(name: string, options?: { scope?: string }): void {
    const scope = this.normalizeScopeKey(options?.scope);
    this.plugins.get(scope)?.delete(name);
    if (this.plugins.get(scope)?.size === 0) {
      this.plugins.delete(scope);
    }
    this.refreshProviderVisibility(options?.scope);
    this.logger.info(`Plugin removed: ${name} (scope=${scope})`);
  }

  public list(): string[] {
    return [...(this.plugins.get("global")?.keys() ?? [])];
  }

  public getToolDefinitions(scope?: string): RegisteredToolDefinition[] {
    return this.collectToolDefinitions(scope);
  }

  public getToolSet(): Record<string, AiTool> {
    return Object.fromEntries(this.getToolDefinitions().map((d) => [d.name, d.tool]));
  }

  public getInstructionContributors(scope?: string): InstructionContributorLike[] {
    const contributors: InstructionContributorLike[] = [];
    this.pushInstructionContributors("global", contributors);
    const scopeKey = this.normalizeScopeKey(scope);
    if (scopeKey !== "global") {
      this.pushInstructionContributors(scopeKey, contributors);
    }

    return contributors;
  }

  public async compileTools(request: CompileToolsRequest): Promise<ToolCatalog> {
    const scopeKey = this.normalizeScopeKey(request.scope);
    const catalogKey = this.getChannelCatalogKey(request.runtime.channelKey, request.scope);
    const cached = this.channelTools.get(catalogKey);
    if (cached) {
      return cached.catalog;
    }

    const definitions = this.getToolDefinitions(request.scope);
    const tools: ToolSet = {
      send_message: request.sendMessageTool,
    };
    const handles: Record<string, ToolHandle> = {};

    for (const definition of definitions) {
      if (definition.definition.match?.({ runtime: request.runtime }) === false) {
        continue;
      }
      if (PluginService.RESERVED_TOOL_NAMES.has(definition.name)) {
        throw new Error(`Reserved tool name: ${definition.name}`);
      }
      if (tools[definition.name]) {
        throw new Error(`Duplicate tool name: ${definition.name}`);
      }
      tools[definition.name] = definition.tool;
      handles[definition.name] = {
        pluginName: definition.pluginName,
        name: definition.name,
        definition: definition.definition,
        tool: definition.tool,
      };
    }

    const catalog = {
      tools,
      handles,
      signature: JSON.stringify(Object.keys(tools).sort()),
    } satisfies ToolCatalog;

    this.channelTools.set(catalogKey, {
      channelKey: request.runtime.channelKey,
      scopeKey,
      signature: catalog.signature,
      catalog,
    });

    const scopedCatalogs = this.scopeIndex.get(scopeKey) ?? new Set<string>();
    scopedCatalogs.add(catalogKey);
    this.scopeIndex.set(scopeKey, scopedCatalogs);

    return catalog;
  }

  public async buildResponseContext<THostInput = unknown>(
    request: BuildResponseContextRequest<THostInput>,
  ): Promise<ResponseContext> {
    const responseContext: ResponseContext = {};

    for (const handle of Object.values(request.catalog.handles)) {
      const extension = handle.definition.extendResponse?.(request.hostInput, request.runtime);
      if (extension === undefined) {
        continue;
      }
      const pluginContext = (responseContext[handle.pluginName] ??= {});
      pluginContext[handle.name] = {
        ...(pluginContext[handle.name] ?? {}),
        ...extension,
      };
    }

    return responseContext;
  }

  public async selectTools(request: SelectToolsRequest): Promise<ToolSelection> {
    const activeTools: ToolSet = { send_message: request.catalog.tools.send_message };

    for (const handle of Object.values(request.catalog.handles)) {
      if (
        handle.definition.enable?.({
          runtime: request.runtime,
          responseContext: request.responseContext,
        }) === false
      ) {
        continue;
      }
      activeTools[handle.name] = request.catalog.tools[handle.name];
    }

    return {
      activeTools,
      activeToolNames: Object.keys(activeTools),
      responseContext: request.responseContext,
    };
  }

  public async invoke(request: ToolInvoke): Promise<unknown> {
    const catalogKey = this.getChannelCatalogKey(request.runtime.channelKey, request.scope);
    const catalog = this.channelTools.get(catalogKey)?.catalog;
    if (!catalog) {
      throw new Error(`Tool catalog not compiled for channel scope: ${catalogKey}`);
    }
    const responseContext = await this.buildResponseContext({
      runtime: request.runtime,
      hostInput: request.hostInput,
      scope: request.scope,
      catalog,
    });
    const selection = await this.selectTools({
      runtime: request.runtime,
      scope: request.scope,
      catalog,
      responseContext,
    });
    const tool = selection.activeTools[request.name];
    if (!tool?.execute) {
      throw new Error(`Tool not found: ${request.name}`);
    }
    return tool.execute(request.input as never, {
      toolCallId: request.options?.toolCallId ?? `invoke:${request.name}`,
      messages: request.options?.messages ?? [],
      abortSignal: request.options?.abortSignal,
      experimental_context: responseContext,
    });
  }

  private refreshProviderVisibility(scope?: string): void {
    this.invalidateToolCatalogs(scope);
  }

  private assertPluginToolDefinitions(plugin: YesImPlugin, scope?: string): void {
    this.assertToolDefinitions([
      ...this.collectToolDefinitions(scope),
      ...plugin.getToolDefinitions(),
    ]);
  }

  private collectToolDefinitions(scope?: string): RegisteredToolDefinition[] {
    const definitions: RegisteredToolDefinition[] = [];
    this.pushPluginDefinitions("global", definitions);
    const scopeKey = this.normalizeScopeKey(scope);
    if (scopeKey !== "global") {
      this.pushPluginDefinitions(scopeKey, definitions);
    }
    this.assertToolDefinitions(definitions);
    return definitions;
  }

  private pushPluginDefinitions(scope: string, out: RegisteredToolDefinition[]): void {
    for (const plugin of this.plugins.get(scope)?.values() ?? []) {
      out.push(...plugin.getToolDefinitions());
    }
  }

  private pushInstructionContributors(scope: string, out: InstructionContributorLike[]): void {
    for (const plugin of this.plugins.get(scope)?.values() ?? []) {
      const provider = plugin as YesImPlugin & {
        getInstructionContributors?: () => InstructionContributorLike[];
      };
      const contributors = provider.getInstructionContributors?.();
      if (!contributors || contributors.length === 0) {
        continue;
      }

      out.push(...contributors);
    }
  }

  private normalizeScopeKey(scope?: string): string {
    return scope ?? "global";
  }

  private getChannelCatalogKey(channelKey: string, scope?: string): string {
    return `${channelKey}:${this.normalizeScopeKey(scope)}`;
  }

  private invalidateToolCatalogs(scope?: string): void {
    if (scope === undefined) {
      this.channelTools.clear();
      this.scopeIndex.clear();
      return;
    }

    const scopeKey = this.normalizeScopeKey(scope);
    const catalogKeys = this.scopeIndex.get(scopeKey);
    if (!catalogKeys) {
      return;
    }
    for (const catalogKey of catalogKeys) {
      this.channelTools.delete(catalogKey);
    }
    this.scopeIndex.delete(scopeKey);
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
      throw new Error(`Reserved tool name: ${definition.name}`);
    }

    const previousPlugin = seen.get(definition.name);
    if (previousPlugin) {
      throw new Error(`Duplicate tool name: ${definition.name}`);
    }

    seen.set(definition.name, pluginName);
  }
}
