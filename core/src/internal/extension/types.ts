/**
 * Extension system types for core.
 *
 * Core owns extension definitions and lifecycle.
 * Agent package provides per-channel hook execution.
 */

import type { ToolResultOutput } from "@ai-sdk/provider-utils";
import type { AgentTool } from "@yesimbot/agent/agent";
import type { HookEventName, HookHandlerFor } from "@yesimbot/agent/session";
import type { Bot } from "koishi";

import type { SpeakElementDefinition, SpeakElementPromptInfo } from "../platform/speak.js";

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

export interface ExtensionToolContext {
  register<INPUT = unknown, OUTPUT = ToolResultOutput, DETAILS = never>(
    tool: ToolDefinition<INPUT, OUTPUT, DETAILS>,
  ): void;
  unregister(name: string): void;
  getActive(): string[];
  setActive(toolNames: string[]): void;
}

export interface ExtensionSessionContext {
  getName(): string | undefined;
  setName(name: string): void;
  appendEntry(customType: string, data?: unknown): void;
  sendMessage(message: unknown, options?: unknown): void;
  sendUserMessage(content: unknown, options?: unknown): void;
}

export interface ExtensionPlatformContext {
  readonly name: string;
  readonly bot: Bot | undefined;
  registerSpeakElement(definition: SpeakElementDefinition): () => void;
}

export interface SpeakElementPromptContext {
  elements: SpeakElementPromptInfo[];
}

export interface ExtensionContext {
  readonly channel: Channel;
  readonly tool: ExtensionToolContext;
  readonly session: ExtensionSessionContext;
  readonly platform: ExtensionPlatformContext;
  on<K extends HookEventName>(event: K, handler: HookHandlerFor<K>): void;
  on(event: string, handler: (...args: unknown[]) => unknown): void;
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

export interface ExtensionDefinitionChange {
  readonly type: "registered" | "unregistered";
  readonly extensionId: string;
}

export type ExtensionDefinitionListener = (
  change: ExtensionDefinitionChange,
) => void | Promise<void>;

export interface ExtensionRegistry {
  registerExtension(definition: ExtensionDefinition): Promise<void>;
  unregisterExtension(id: string): Promise<void>;
  getExtension(id: string): ExtensionDefinition | undefined;
  getAllDefinitions(): ExtensionDefinition[];
  subscribeDefinitions(listener: ExtensionDefinitionListener): () => void;
}
