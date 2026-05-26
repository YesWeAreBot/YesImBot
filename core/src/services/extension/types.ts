/**
 * Extension system types for core.
 *
 * Core owns extension definitions and lifecycle.
 * Agent package provides per-channel hook execution.
 */

import type { ToolResultOutput } from "@ai-sdk/provider-utils";
import type { AgentTool } from "@yesimbot/agent/agent";
import type { HookRunner } from "@yesimbot/agent/session";
import type { Bot } from "koishi";

import type { SpeakElementDefinition, SpeakElementPromptInfo } from "../../internal/bot/types.js";

// ============================================================================
// Channel
// ============================================================================

/**
 * 频道信息（用于 runtime、extension、session 等模块共享的 Koishi/platform 上下文）
 */
export interface Channel {
  /** 平台标识，如 "onebot"、"sandbox:6nxstem9j43" */
  platform: string;
  /** 频道标识 */
  channelId: string;
  /** 频道类型 */
  type: "private" | "group";
  /** Koishi Bot 实例（如果可用） */
  bot?: Bot;
}

// ============================================================================
// Core-Owned Extension Types
// ============================================================================

export interface ExtensionDefinition {
  id: string;
  order?: number;
  setup(ctx: ExtensionContext): void | Promise<void> | ExtensionCleanup | Promise<ExtensionCleanup>;
}

export interface ExtensionCleanup {
  dispose?(): void | Promise<void>;
}

export type ToolDefinition<INPUT = unknown, OUTPUT = ToolResultOutput, DETAILS = never> = AgentTool<
  INPUT,
  OUTPUT,
  DETAILS
> & {
  name: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
};

// ============================================================================
// Core-Owned Extension Context
// ============================================================================

export interface ExtensionBotContext {
  registerSpeakElement(definition: SpeakElementDefinition): void;
}

export interface SpeakElementPromptContext {
  elements: SpeakElementPromptInfo[];
}

export interface ExtensionContext {
  readonly channel: Channel;
  readonly bot: ExtensionBotContext;
  /** 注册 channel lifecycle hook；事件分发由 agent package 的 HookRunner 执行。 */
  on(event: string, handler: (...args: unknown[]) => unknown): void;
  registerTool<INPUT = unknown, OUTPUT = ToolResultOutput, DETAILS = never>(
    tool: ToolDefinition<INPUT, OUTPUT, DETAILS>,
  ): void;
  unregisterTool(name: string): void;
  sendMessage(message: unknown, options?: unknown): void;
  sendUserMessage(content: unknown, options?: unknown): void;
  appendEntry(customType: string, data?: unknown): void;
  setSessionName(name: string): void;
  getSessionName(): string | undefined;
  getActiveTools(): string[];
  setActiveTools(toolNames: string[]): void;
}

// ============================================================================
// Extension Binding
// ============================================================================

export interface ExtensionBinding {
  readonly id: string;
  readonly order: number;
  readonly handlers: Map<string, Array<(...args: unknown[]) => unknown>>;
  readonly tools: Map<string, ToolDefinition>;
  readonly speakElements: Map<string, SpeakElementDefinition>;
  readonly cleanup?: ExtensionCleanup;
}

// ============================================================================
// Tool Snapshot
// ============================================================================

/**
 * 扩展工具快照 — 用于原子下发给 agent
 *
 * 包含某个 channel runtime 中所有扩展注册的工具
 * 结构与 @yesimbot/agent 的 ExtensionToolSnapshot 对齐（Map 形式）
 */
export interface ExtensionToolSnapshot {
  /** 工具定义 Map（name → definition） */
  readonly tools: Map<string, AgentTool>;
  /** 活跃工具名称列表 */
  readonly activeToolNames: string[];
}

// ============================================================================
// Reload Summary
// ============================================================================

/**
 * 单个 channel 的 reload 结果
 */
export interface ChannelReloadResult {
  /** 频道标识 */
  readonly channelKey: string;
  /** 是否成功 */
  readonly success: boolean;
  /** 失败时的错误信息 */
  readonly error?: string;
  /** 加载的扩展数量（成功的） */
  readonly loadedCount: number;
  /** 失败的扩展 ID 列表 */
  readonly failedExtensions?: string[];
}

/**
 * reload 操作的聚合结果
 *
 * 单个 channel 失败不阻断其他 channel
 */
export interface ReloadSummary {
  /** 总 channel 数 */
  readonly totalChannels: number;
  /** 成功的 channel 数 */
  readonly successCount: number;
  /** 失败的 channel 数 */
  readonly failureCount: number;
  /** 各 channel 的详细结果 */
  readonly results: ChannelReloadResult[];
  /** 是否全部成功 */
  readonly allSucceeded: boolean;
}

export interface ExtensionDefinitionChange {
  readonly type: "registered" | "unregistered";
  readonly extensionId: string;
}

export type ExtensionDefinitionListener = (
  change: ExtensionDefinitionChange,
) => void | Promise<void | ReloadSummary>;

export interface ExtensionRegistry {
  registerExtension(definition: ExtensionDefinition): Promise<ReloadSummary>;
  unregisterExtension(id: string): Promise<ReloadSummary>;
  getExtension(id: string): ExtensionDefinition | undefined;
  getAllDefinitions(): ExtensionDefinition[];
  subscribeDefinitions(listener: ExtensionDefinitionListener): () => void;
}

// ============================================================================
// Channel Runtime
// ============================================================================

/**
 * Channel runtime — 每个 channel 的扩展运行时实例
 *
 * 由 ExtensionService.createChannelRuntime 创建
 */
export interface ChannelRuntime {
  /** 频道标识 */
  readonly channelKey: string;
  /** 加载的扩展工具快照 */
  readonly toolSnapshot: ExtensionToolSnapshot;
  /** HookRunner — 传给 AgentSession 用于 hook 分发 */
  readonly hookRunner: HookRunner;
  /** setup 过程中的错误（fail-open） */
  readonly errors: ChannelRuntimeError[];
  /** 销毁运行时，调用所有 cleanup */
  dispose(): Promise<void>;
}

/**
 * Channel runtime 中单个扩展的错误
 */
export interface ChannelRuntimeError {
  /** 扩展 ID */
  readonly extensionId: string;
  /** 错误信息 */
  readonly error: string;
  /** 错误堆栈 */
  readonly stack?: string;
}
