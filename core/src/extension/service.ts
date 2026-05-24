/**
 * ExtensionService — 统一的扩展生命周期管理
 *
 * 职责：
 * - 管理 extension definitions（全局注册/卸载）
 * - 管理 per-channel runtime（创建/销毁/重载）
 * - 收集 tool snapshot（原子下发给 agent）
 * - 构建 `ExtensionContext`，并把 hook 处理器注册到 `HookRunner`
 *
 * 错误策略：
 * - 单个 channel setup 失败 → fail-open，记录错误并继续
 * - register/unregister 聚合所有 channel 结果，不回滚全局定义
 */

import { HookRunner, type SessionManager } from "@yesimbot/agent/session";
import { Context, Logger, Service } from "koishi";

import type {
  Channel,
  ChannelReloadResult,
  ChannelRuntime,
  ChannelRuntimeError,
  ExtensionBinding,
  ExtensionCleanup,
  ExtensionContext,
  ExtensionDefinition,
  ExtensionToolSnapshot,
  ReloadSummary,
  ToolDefinition,
} from "./types.js";

declare module "koishi" {
  export interface Context {
    "yesimbot.extension": ExtensionService;
  }
}

// ============================================================================
// Internal Types
// ============================================================================

export interface ExtensionConfig {
  basePath: string;
  chatModel: string;
  logLevel?: number;
}

/**
 * 内部 channel runtime 选项。
 *
 * 这是 `ExtensionService` 的私有 wiring contract，不暴露旧的 public host abstraction。
 */
interface CreateChannelRuntimeOptions {
  channel: Channel;
  hookRunner: HookRunner;
  sessionManager: SessionManager;
  applyToolState(snapshot: ExtensionToolSnapshot): void;
  sendMessage(message: unknown, options?: unknown): Promise<void>;
  sendUserMessage(content: unknown, options?: unknown): Promise<void>;
  appendEntry(customType: string, data?: unknown): void;
  setSessionName(name: string): void;
  getSessionName(): string | undefined;
  getActiveTools(): string[];
  setActiveTools(toolNames: string[]): void;
}

interface ChannelRuntimeState {
  channelKey: string;
  channel: Channel;
  options: CreateChannelRuntimeOptions;
  hookRunner: HookRunner;
  bindings: ExtensionBinding[];
  errors: ChannelRuntimeError[];
}

// ============================================================================
// Helpers
// ============================================================================

function channelKeyOf(channel: Pick<Channel, "platform" | "channelId">): string {
  return `${channel.platform}:${channel.channelId}`;
}

// ============================================================================
// ExtensionService
// ============================================================================

export class ExtensionService extends Service<ExtensionConfig> {
  readonly logger: Logger;

  /** 全局扩展定义 */
  private definitions = new Map<string, ExtensionDefinition>();

  /** per-channel runtime 状态 */
  private channels = new Map<string, ChannelRuntimeState>();

  constructor(
    public ctx: Context,
    public config: ExtensionConfig,
  ) {
    super(ctx, "yesimbot.extension");
    this.logger = ctx.logger("yesimbot.extension");
    this.logger.level = config.logLevel ?? 2;
  }

  protected async start() {
    this.logger.info("Starting yesimbot extension service");
  }

  // =========================================================================
  // Extension Registration
  // =========================================================================

  /**
   * 注册扩展定义并重载所有 channel runtime
   *
   * 全局定义始终保留，即使某个 channel reload 失败
   */
  async registerExtension(extension: ExtensionDefinition): Promise<ReloadSummary> {
    this.definitions.set(extension.id, extension);
    this.logger.info(`Registered extension: ${extension.id}`);
    return this._reloadAllChannels(`register:${extension.id}`);
  }

  /**
   * 卸载扩展定义并重载所有 channel runtime
   */
  async unregisterExtension(id: string): Promise<ReloadSummary> {
    if (!this.definitions.has(id)) {
      this.logger.warn(`Extension not found: ${id}`);
      return this._emptySummary();
    }
    this.definitions.delete(id);
    this.logger.info(`Unregistered extension: ${id}`);
    return this._reloadAllChannels(`unregister:${id}`);
  }

  /**
   * 获取扩展定义
   */
  getExtension(id: string): ExtensionDefinition | undefined {
    return this.definitions.get(id);
  }

  /**
   * 获取所有扩展定义
   */
  getAllDefinitions(): ExtensionDefinition[] {
    return Array.from(this.definitions.values());
  }

  // =========================================================================
  // Channel Runtime Lifecycle
  // =========================================================================

  /**
   * 为指定 channel 创建 runtime
   *
   * await 全部 extension setup 完成，setup 失败时 fail-open
   *
   */
  async createChannelRuntime(options: CreateChannelRuntimeOptions): Promise<ChannelRuntime> {
    const key = channelKeyOf(options.channel);

    // 如果已存在，先销毁
    if (this.channels.has(key)) {
      this.logger.info(`Disposing existing runtime for channel ${key}`);
      await this.disposeChannelRuntime(options.channel);
    }

    const state: ChannelRuntimeState = {
      channelKey: key,
      channel: options.channel,
      options,
      hookRunner: options.hookRunner,
      bindings: [],
      errors: [],
    };
    this.channels.set(key, state);
    await this._reloadChannel(state);
    return this._buildChannelRuntime(state);
  }

  /**
   * 销毁指定 channel 的 runtime
   *
   * 调用所有 extension cleanup，单个 cleanup 失败不阻断其他 cleanup
   */
  async disposeChannelRuntime(channel: Channel): Promise<void> {
    const key = channelKeyOf(channel);
    const state = this.channels.get(key);
    if (!state) return;

    // 调用所有 cleanup，fail-open on per-cleanup errors
    for (const binding of state.bindings) {
      try {
        await binding.cleanup?.dispose?.();
      } catch (err) {
        this.logger.warn(
          `Cleanup error for channel ${key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 清理 hooks 和工具状态
    state.hookRunner.clear();
    state.options.applyToolState({ tools: new Map(), activeToolNames: [] });
    this.channels.delete(key);
    this.logger.info(`Disposed runtime for channel ${key}`);
  }

  /**
   * 获取指定 channel 的 runtime（如果存在）
   */
  getChannelRuntime(channel: Channel): ChannelRuntime | undefined {
    const key = channelKeyOf(channel);
    const state = this.channels.get(key);
    if (!state) return undefined;
    return this._buildChannelRuntime(state);
  }

  // =========================================================================
  // Tool Snapshot
  // =========================================================================

  /**
   * 构建指定 channel 的工具快照
   *
   * 收集 per-channel extension bindings 中的所有工具，
   * 返回 Map<string, AgentTool> 供 agent 原子消费
   */
  buildToolSnapshot(channel: Channel): ExtensionToolSnapshot {
    const key = channelKeyOf(channel);
    const state = this.channels.get(key);

    if (!state) {
      return { tools: new Map(), activeToolNames: [] };
    }

    return this._buildToolSnapshotFromBindings(state.bindings);
  }

  /**
   * 获取指定 channel 的提示工具上下文
   *
   * 从当前 channel bindings 和 host active tools 中读取
   * selectedTools、toolSnippets 和 promptGuidelines，
   * 供系统提示扩展构建工具部分。
   */
  getPromptToolContext(channel: Channel): {
    selectedTools: string[];
    toolSnippets: Record<string, string>;
    promptGuidelines: string[];
  } {
    const key = channelKeyOf(channel);
    const state = this.channels.get(key);

    if (!state) {
      return { selectedTools: [], toolSnippets: {}, promptGuidelines: [] };
    }

    const activeToolNames = state.options.getActiveTools();
    const toolSnippets: Record<string, string> = {};
    const promptGuidelinesSet = new Set<string>();

    for (const binding of state.bindings) {
      for (const [name, tool] of binding.tools) {
        if (tool.promptSnippet) {
          toolSnippets[name] = tool.promptSnippet;
        }
        if (tool.promptGuidelines) {
          for (const g of tool.promptGuidelines) {
            const trimmed = g.trim();
            if (trimmed.length > 0) {
              promptGuidelinesSet.add(trimmed);
            }
          }
        }
      }
    }

    const selectedTools = activeToolNames.filter((name) => !!toolSnippets[name]);
    const promptGuidelines = Array.from(promptGuidelinesSet);

    return { selectedTools, toolSnippets, promptGuidelines };
  }

  // =========================================================================
  // Internal: Binding Helpers
  // =========================================================================

  /**
   * 为单个扩展定义创建绑定
   *
   * 调用 def.setup(ctx) 收集 handlers 和 tools，
   * 返回 ExtensionBinding 供后续安装到 HookRunner
   */
  private async _createBinding(
    def: ExtensionDefinition,
    options: CreateChannelRuntimeOptions,
  ): Promise<ExtensionBinding> {
    const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
    const tools = new Map<string, ToolDefinition>();
    let active = true;
    const assertActive = () => {
      if (!active) {
        throw new Error(`Extension context for ${def.id} is no longer active`);
      }
    };

    const ctx: ExtensionContext = {
      get channel() {
        return options.channel;
      },
      on(event, handler) {
        assertActive();
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
      registerTool(tool) {
        assertActive();
        tools.set(tool.name, tool as ToolDefinition);
      },
      unregisterTool(name) {
        assertActive();
        tools.delete(name);
      },
      sendMessage(message, sendOptions) {
        void options.sendMessage(message, sendOptions);
      },
      sendUserMessage(content, sendOptions) {
        void options.sendUserMessage(content, sendOptions);
      },
      appendEntry: (customType, data) => options.appendEntry(customType, data),
      setSessionName: (name) => options.setSessionName(name),
      getSessionName: () => options.getSessionName(),
      getActiveTools: () => options.getActiveTools(),
      setActiveTools: (toolNames) => options.setActiveTools(toolNames),
    };

    const cleanup = await def.setup(ctx);
    active = false;

    return {
      id: def.id,
      order: def.order ?? 0,
      handlers,
      tools,
      cleanup: cleanup && typeof cleanup === "object" ? (cleanup as ExtensionCleanup) : undefined,
    };
  }

  /**
   * 将绑定的 handlers 安装到 HookRunner
   *
   * 先清空 HookRunner，再按绑定顺序注册所有 handlers
   */
  private _installBindings(hookRunner: HookRunner, bindings: ExtensionBinding[]): void {
    hookRunner.clear();
    for (const binding of bindings) {
      for (const [event, handlers] of binding.handlers) {
        for (const handler of handlers) {
          hookRunner.on(event, handler);
        }
      }
    }
  }

  /**
   * 从绑定列表构建工具快照
   *
   * 收集所有绑定注册的工具，转换为 AgentTool 格式
   */
  private _buildToolSnapshotFromBindings(
    bindings: readonly ExtensionBinding[],
  ): ExtensionToolSnapshot {
    const tools = new Map<string, import("@yesimbot/agent/agent").AgentTool>();
    const activeToolNames: string[] = [];

    for (const binding of bindings) {
      for (const [name, tool] of binding.tools) {
        const {
          promptSnippet: _promptSnippet,
          promptGuidelines: _promptGuidelines,
          name: _name,
          ...agentTool
        } = tool;
        tools.set(name, agentTool as import("@yesimbot/agent/agent").AgentTool);
        activeToolNames.push(name);
      }
    }

    return { tools, activeToolNames };
  }

  // =========================================================================
  // Internal: Channel Reload
  // =========================================================================

  /**
   * 重载单个 channel 的所有扩展
   *
   * 清理旧绑定 → 创建新绑定 → 安装到 HookRunner → 应用工具快照
   */
  private async _reloadChannel(state: ChannelRuntimeState): Promise<ChannelReloadResult> {
    // 按 order 排序全局定义
    const sorted = Array.from(this.definitions.values()).sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );

    // 清理旧绑定
    for (const old of state.bindings) {
      try {
        await old.cleanup?.dispose?.();
      } catch (err) {
        state.errors.push({
          extensionId: old.id,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }

    // 创建新绑定
    const nextBindings: ExtensionBinding[] = [];
    const reloadErrors: ChannelRuntimeError[] = [];
    for (const def of sorted) {
      try {
        nextBindings.push(await this._createBinding(def, state.options));
      } catch (err) {
        reloadErrors.push({
          extensionId: def.id,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }

    // 更新状态
    state.bindings = nextBindings;
    state.errors.push(...reloadErrors);
    this._installBindings(state.hookRunner, nextBindings);
    state.options.applyToolState(this._buildToolSnapshotFromBindings(nextBindings));

    return {
      channelKey: state.channelKey,
      success: reloadErrors.length === 0,
      loadedCount: nextBindings.length,
      failedExtensions: reloadErrors.map((e) => e.extensionId),
      error: reloadErrors.length
        ? reloadErrors.map((e) => `${e.extensionId}: ${e.error}`).join("; ")
        : undefined,
    };
  }

  /**
   * 重载所有 channel 并聚合结果
   *
   * 单个 channel 的 reload 异常不会阻断其他 channel
   */
  private async _reloadAllChannels(trigger: string): Promise<ReloadSummary> {
    const results: ChannelReloadResult[] = [];

    for (const [, state] of this.channels) {
      try {
        const result = await this._reloadChannel(state);
        results.push(result);
      } catch (err) {
        // Safety net: if _reloadChannel itself throws unexpectedly
        const error = err instanceof Error ? err.message : String(err);
        this.logger.error(`Channel ${state.channelKey} reload threw unexpectedly: ${error}`);
        results.push({
          channelKey: state.channelKey,
          success: false,
          loadedCount: 0,
          error,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    const summary: ReloadSummary = {
      totalChannels: results.length,
      successCount,
      failureCount,
      results,
      allSucceeded: failureCount === 0,
    };

    if (failureCount > 0) {
      this.logger.warn(`Reload ${trigger}: ${successCount}/${results.length} channels succeeded`);
    } else if (results.length > 0) {
      this.logger.info(`Reload ${trigger}: all ${results.length} channels succeeded`);
    }

    return summary;
  }

  // =========================================================================
  // Internal: Helpers
  // =========================================================================

  /**
   * 构建 ChannelRuntime 返回值
   *
   * 不包含 extensionRunner — 核心拥有绑定生命周期
   */
  private _buildChannelRuntime(state: ChannelRuntimeState): ChannelRuntime {
    return {
      channelKey: state.channelKey,
      toolSnapshot: this._buildToolSnapshotFromBindings(state.bindings),
      hookRunner: state.hookRunner,
      errors: [...state.errors],
      dispose: () => this.disposeChannelRuntime(state.channel),
    };
  }

  private _emptySummary(): ReloadSummary {
    return {
      totalChannels: 0,
      successCount: 0,
      failureCount: 0,
      results: [],
      allSucceeded: true,
    };
  }
}
