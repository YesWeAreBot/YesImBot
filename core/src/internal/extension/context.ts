import type {
  ExtensionBinding,
  ExtensionCleanup,
  ExtensionContext,
  ExtensionDefinition,
  ToolDefinition,
} from "../../services/extension/types.js";
import type { SpeakElementDefinition } from "../bot/types.js";
import type { CreateExtensionChannelRuntimeOptions } from "./runtime.js";

export async function createExtensionBinding(
  def: ExtensionDefinition,
  options: CreateExtensionChannelRuntimeOptions,
): Promise<ExtensionBinding> {
  const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const tools = new Map<string, ToolDefinition>();
  const speakElements = new Map<string, SpeakElementDefinition>();
  const speakElementDisposers: Array<() => void> = [];
  let active = true;
  const assertActive = () => {
    if (!active) throw new Error(`Extension context for ${def.id} is no longer active`);
  };

  const ctx: ExtensionContext = {
    get channel() {
      return options.channel;
    },
    bot: {
      registerSpeakElement(definition) {
        assertActive();
        if (speakElements.has(definition.tag)) {
          throw new Error(`Speak element "${definition.tag}" is already registered by ${def.id}`);
        }
        speakElements.set(definition.tag, definition);
        if (options.registerSpeakElement) {
          speakElementDisposers.push(options.registerSpeakElement(definition));
        }
      },
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
  const cleanupObject =
    cleanup && typeof cleanup === "object" ? (cleanup as ExtensionCleanup) : undefined;
  const combinedCleanup =
    cleanupObject || speakElementDisposers.length > 0
      ? {
          async dispose() {
            for (const dispose of speakElementDisposers.splice(0)) dispose();
            await cleanupObject?.dispose?.();
          },
        }
      : undefined;

  return {
    id: def.id,
    order: def.order ?? 0,
    handlers,
    tools,
    speakElements,
    cleanup: combinedCleanup,
  };
}
