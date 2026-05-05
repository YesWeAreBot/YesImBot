import { createEventBus, type EventBus } from "../event-bus.js";
import type {
  ExtensionAPI,
  ExtensionBinding,
  ExtensionCleanup,
  ExtensionDefinition,
  ExtensionRuntime,
  ToolDefinition,
} from "./types.js";

type HandlerFn = (...args: unknown[]) => Promise<unknown>;

/**
 * 创建 ExtensionRuntime，初始为 throwing stubs。
 * Runner.bindCore() 会替换为真实实现。
 */
export function createExtensionRuntime(): ExtensionRuntime {
  const notInitialized = () => {
    throw new Error(
      "Extension runtime not initialized. Action methods cannot be called during extension loading.",
    );
  };
  const state: { staleMessage?: string } = {};
  const assertActive = () => {
    if (state.staleMessage) {
      throw new Error(state.staleMessage);
    }
  };

  const runtime: ExtensionRuntime = {
    sendMessage: notInitialized,
    sendUserMessage: notInitialized,
    appendEntry: notInitialized,
    setSessionName: notInitialized,
    getSessionName: notInitialized,
    getActiveTools: notInitialized,
    setActiveTools: notInitialized,
    refreshTools: () => {},
    assertActive,
    invalidate: (message) => {
      state.staleMessage ??=
        message ?? "This extension instance is stale after session replacement or reload.";
    },
  };

  return runtime;
}

/**
 * 为单个 ExtensionDefinition 创建 binding（异步版本）。
 * 调用 definition.setup()，收集 handlers 和 tools。
 */
export async function createExtensionBinding(
  definition: ExtensionDefinition,
  generation: number,
  runtime: ExtensionRuntime,
  eventBus: EventBus,
): Promise<ExtensionBinding> {
  const binding: ExtensionBinding = {
    id: definition.id,
    order: definition.order ?? 0,
    generation,
    handlers: new Map(),
    tools: new Map(),
  };

  const api = createExtensionAPI(binding, runtime, eventBus);
  const cleanupOrVoid = await definition.setup(api);
  if (cleanupOrVoid && typeof cleanupOrVoid === "object" && "dispose" in cleanupOrVoid) {
    binding.cleanup = cleanupOrVoid as ExtensionCleanup;
  }

  return binding;
}

/**
 * 为单个 ExtensionDefinition 创建 binding（同步版本）。
 * 用于构造函数初始化。setup 返回 Promise 时后台处理 cleanup。
 */
export function createExtensionBindingSync(
  definition: ExtensionDefinition,
  generation: number,
  runtime: ExtensionRuntime,
  eventBus: EventBus,
): ExtensionBinding {
  const binding: ExtensionBinding = {
    id: definition.id,
    order: definition.order ?? 0,
    generation,
    handlers: new Map(),
    tools: new Map(),
  };

  const api = createExtensionAPI(binding, runtime, eventBus);
  const result = definition.setup(api) as unknown;

  if (result && typeof result === "object" && "then" in result) {
    (result as Promise<unknown>)
      .then((cleanup) => {
        if (cleanup && typeof cleanup === "object" && "dispose" in cleanup) {
          binding.cleanup = cleanup as ExtensionCleanup;
        }
      })
      .catch((err) => {
        console.error(`[Extension] setup failed for "${definition.id}":`, err);
      });
  } else if (result && typeof result === "object" && "dispose" in result) {
    binding.cleanup = result as ExtensionCleanup;
  }

  return binding;
}

/**
 * 创建 ExtensionAPI。
 * 注册方法写入 binding，action 方法委托给 runtime。
 */
function createExtensionAPI(
  binding: ExtensionBinding,
  runtime: ExtensionRuntime,
  eventBus: EventBus,
): ExtensionAPI {
  return {
    on(event: string, handler: HandlerFn): void {
      runtime.assertActive();
      const list = binding.handlers.get(event) ?? [];
      list.push(handler);
      binding.handlers.set(event, list);
    },

    registerTool(tool: ToolDefinition): void {
      runtime.assertActive();
      binding.tools.set(tool.name, tool);
      runtime.refreshTools();
    },

    sendMessage(message, options): void {
      runtime.assertActive();
      runtime.sendMessage(message, options);
    },

    sendUserMessage(content, options): void {
      runtime.assertActive();
      runtime.sendUserMessage(content, options);
    },

    appendEntry(customType: string, data?: unknown): void {
      runtime.assertActive();
      runtime.appendEntry(customType, data);
    },

    setSessionName(name: string): void {
      runtime.assertActive();
      runtime.setSessionName(name);
    },

    getSessionName(): string | undefined {
      runtime.assertActive();
      return runtime.getSessionName();
    },

    getActiveTools(): string[] {
      runtime.assertActive();
      return runtime.getActiveTools();
    },

    setActiveTools(toolNames: string[]): void {
      runtime.assertActive();
      runtime.setActiveTools(toolNames);
    },

    events: eventBus,
  } as ExtensionAPI;
}
