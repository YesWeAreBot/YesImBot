/**
 * ExtensionService — 统一的扩展生命周期管理
 *
 * 职责：
 * - 管理 extension definitions（全局注册/卸载）
 * - 管理 per-channel runtime（创建/销毁/重载）
 * - 收集 tool snapshot（原子下发给 agent）
 * - 提供内部 typed registration API 给 HookRunner
 *
 * 错误策略：
 * - 单个 channel setup 失败 → fail-open，记录错误并继续
 * - register/unregister 聚合所有 channel 结果，不回滚全局定义
 */

import type {
  ExtensionAPI,
  HookRunner as HookRunnerType,
  ToolDefinition,
} from "@yesimbot/agent/session";
import { createExtensionRuntime, HookRunner as HookRunnerClass } from "@yesimbot/agent/session";
import { ExtensionRunner } from "@yesimbot/agent/session";
import { Context, Logger, Service } from "koishi";

import type {
  AthenaExtensionDefinition,
  ChannelContext,
  ChannelReloadResult,
  ChannelRuntime,
  ChannelRuntimeError,
  ExtensionToolSnapshot,
  ReloadSummary,
} from "./types.js";

// Re-export types for consumers
export type {
  AthenaExtensionDefinition,
  ChannelContext,
  ChannelReloadResult,
  ChannelRuntime,
  ChannelRuntimeError,
  ExtensionAPI,
  ExtensionCleanup,
  ExtensionHost,
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

interface ChannelRuntimeState {
  channelKey: string;
  context: ChannelContext;
  runner: ExtensionRunner;
  hookRunner?: HookRunnerType;
  /** 所有 extension setup 产生的 cleanup */
  cleanups: Array<() => void | Promise<void>>;
  errors: ChannelRuntimeError[];
}

// ============================================================================
// Helpers
// ============================================================================

function channelKeyOf(context: ChannelContext): string {
  return `${context.platform}:${context.channelId}`;
}

function convertToAgentDefinition(
  def: AthenaExtensionDefinition,
  context: ChannelContext,
): import("@yesimbot/agent/session").ExtensionDefinition {
  return {
    id: def.id,
    order: def.order,
    setup: (api: ExtensionAPI) => def.setup(api, context),
  };
}

// ============================================================================
// ExtensionService
// ============================================================================

export class ExtensionService extends Service<ExtensionConfig> {
  readonly logger: Logger;

  /** 全局扩展定义 */
  private definitions = new Map<string, AthenaExtensionDefinition>();

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
  async registerExtension(extension: AthenaExtensionDefinition): Promise<ReloadSummary> {
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
  getExtension(id: string): AthenaExtensionDefinition | undefined {
    return this.definitions.get(id);
  }

  /**
   * 获取所有扩展定义
   */
  getAllDefinitions(): AthenaExtensionDefinition[] {
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
   * @param context - 频道上下文
   * @param additionalExtensions - 额外的 per-channel 扩展（如 system-prompt）
   */
  async createChannelRuntime(
    context: ChannelContext,
    additionalExtensions?: import("@yesimbot/agent/session").ExtensionDefinition[],
  ): Promise<ChannelRuntime> {
    const key = channelKeyOf(context);

    // 如果已存在，先销毁
    if (this.channels.has(key)) {
      this.logger.info(`Disposing existing runtime for channel ${key}`);
      await this.disposeChannelRuntime(context);
    }

    const errors: ChannelRuntimeError[] = [];
    const runtime = createExtensionRuntime();

    // Minimal EventBus stub for ExtensionRunner (not used at this level)
    const eventBus = {
      on: () => () => {},
      emit: () => {},
    } satisfies {
      on: (channel: string, handler: (data: unknown) => void) => () => void;
      emit: (channel: string, data: unknown) => void;
    };

    // 创建 HookRunner（给 AgentSession 用于 hook 分发）
    // 注意：这里的 HookContext 是 stub，实际值由 AgentSession.bindCore() 填充
    const hookRunner = new HookRunnerClass(() => ({
      sessionManager: {} as never,
      model: undefined,
      isIdle: () => true,
      signal: undefined,
      abort: () => {},
      hasPendingMessages: () => false,
      getContextUsage: () => undefined,
      compact: () => {},
      getSystemPrompt: () => "",
    }));

    // 创建 runner（空 bindings，后续 reload 填充）
    const runner = new ExtensionRunner([], runtime, this.config.basePath, {} as never, eventBus);

    // 桥接：ExtensionRunner reload 时自动同步 handlers 到 HookRunner
    runner.setHookRunner(hookRunner);

    // 监听 per-extension 错误（setup 失败等），聚合到 state.errors
    // Note: ExtensionError only carries event type + message, not extension ID.
    // The runner emits "setup" events with the error message from createExtensionBinding.
    runner.onError((extError) => {
      errors.push({
        extensionId: extError.event,
        error: extError.error,
        stack: extError.stack,
      });
    });

    const state: ChannelRuntimeState = {
      channelKey: key,
      context,
      runner,
      hookRunner,
      cleanups: [],
      errors,
    };
    this.channels.set(key, state);

    // 执行首次 reload（包含全局定义 + 额外的 per-channel 扩展）
    await this._reloadChannel(state, additionalExtensions);

    return this._buildChannelRuntime(state);
  }

  /**
   * 销毁指定 channel 的 runtime
   *
   * 调用所有 extension cleanup，单个 cleanup 失败不阻断其他 cleanup
   */
  async disposeChannelRuntime(context: ChannelContext): Promise<void> {
    const key = channelKeyOf(context);
    const state = this.channels.get(key);
    if (!state) return;

    const cleanupErrors: Array<{ index: number; error: string }> = [];

    // 调用所有 cleanup，fail-open on per-cleanup errors
    for (let i = 0; i < state.cleanups.length; i++) {
      try {
        await state.cleanups[i]();
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        cleanupErrors.push({ index: i, error });
        this.logger.warn(`Cleanup error #${i} for channel ${key}: ${error}`);
      }
    }

    // 失效 runner
    state.runner.invalidate("Channel runtime disposed");

    if (cleanupErrors.length > 0) {
      this.logger.warn(`Channel ${key} disposed with ${cleanupErrors.length} cleanup error(s)`);
    }

    this.channels.delete(key);
    this.logger.info(`Disposed runtime for channel ${key}`);
  }

  /**
   * 获取指定 channel 的 runtime（如果存在）
   */
  getChannelRuntime(context: ChannelContext): ChannelRuntime | undefined {
    const key = channelKeyOf(context);
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
   * 收集 per-channel extension runtime 中的所有工具，
   * 返回 Map<string, ToolDefinition> 供 agent 原子消费
   */
  buildToolSnapshot(context: ChannelContext): ExtensionToolSnapshot {
    const key = channelKeyOf(context);
    const state = this.channels.get(key);

    if (!state) {
      return { tools: new Map(), activeToolNames: [] };
    }

    const tools = new Map<string, ToolDefinition>();
    const activeToolNames: string[] = [];

    for (const binding of state.runner.getBindings()) {
      for (const [name, tool] of binding.tools) {
        tools.set(name, tool as ToolDefinition);
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
   * Errors from individual extension setup are captured via the runner's
   * error listener (wired in createChannelRuntime). The top-level try/catch
   * guards against unexpected failures in the reload orchestration itself.
   */
  private async _reloadChannel(
    state: ChannelRuntimeState,
    additionalExtensions?: import("@yesimbot/agent/session").ExtensionDefinition[],
  ): Promise<ChannelReloadResult> {
    const { channelKey, context, runner } = state;
    const definitions = [
      ...Array.from(this.definitions.values()).map((def) => convertToAgentDefinition(def, context)),
      ...(additionalExtensions ?? []),
    ];

    // Snapshot error count before reload to isolate new errors
    const prevErrorCount = state.errors.length;

    try {
      await runner.reload(definitions);

      // New errors are those appended by the runner.onError listener during reload
      const newErrors = state.errors.slice(prevErrorCount);
      const failedIds = newErrors.map((e) => e.extensionId);
      const loadedCount = definitions.length - newErrors.length;

      if (newErrors.length > 0) {
        this.logger.warn(
          `Channel ${channelKey}: ${newErrors.length}/${definitions.length} extension(s) failed during reload: ${failedIds.join(", ")}`,
        );
      }

      return {
        channelKey,
        success: newErrors.length === 0,
        loadedCount,
        failedExtensions: failedIds.length > 0 ? failedIds : undefined,
        error:
          newErrors.length > 0
            ? newErrors.map((e) => `${e.extensionId}: ${e.error}`).join("; ")
            : undefined,
      };
    } catch (err) {
      // Unexpected failure in the reload orchestration itself
      const error = err instanceof Error ? err.message : String(err);
      state.errors.push({
        extensionId: "*",
        error,
        stack: err instanceof Error ? err.stack : undefined,
      });
      this.logger.error(`Channel ${channelKey} reload failed: ${error}`);
      return {
        channelKey,
        success: false,
        loadedCount: 0,
        error,
      };
    }
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

  private _buildChannelRuntime(state: ChannelRuntimeState): ChannelRuntime {
    const snapshot = this.buildToolSnapshot(state.context);
    if (!state.hookRunner) {
      throw new Error(
        `Channel runtime ${state.channelKey} has no HookRunner. Use createChannelRuntime instead of registerRunner.`,
      );
    }
    return {
      channelKey: state.channelKey,
      toolSnapshot: snapshot,
      hookRunner: state.hookRunner,
      extensionRunner: state.runner,
      errors: [...state.errors],
      dispose: () => this.disposeChannelRuntime(state.context),
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
