import type { Bot } from "koishi";

import type { SpeakElementDefinition } from "../platform/speak.js";
import type { Channel } from "./types.js";
import type {
  ExtensionBinding,
  ExtensionCleanup,
  ExtensionContext,
  ExtensionDefinition,
  ToolDefinition,
} from "./types.js";

export interface ExtensionBindingHost {
  channel: Channel;
  tool: {
    getActive(): string[];
    setActive(toolNames: string[]): void;
  };
  session: {
    getName(): string | undefined;
    setName(name: string): void;
    appendEntry(customType: string, data?: unknown): void;
    sendMessage(message: unknown, options?: unknown): Promise<void>;
    sendUserMessage(content: unknown, options?: unknown): Promise<void>;
  };
  platform: {
    readonly name: string;
    readonly bot: Bot | undefined;
    registerSpeakElement(definition: SpeakElementDefinition): () => void;
  };
}

export async function createExtensionBinding(
  def: ExtensionDefinition,
  host: ExtensionBindingHost,
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
      return host.channel;
    },
    tool: {
      register(tool) {
        assertActive();
        tools.set(tool.name, tool as ToolDefinition);
      },
      unregister(name) {
        assertActive();
        tools.delete(name);
      },
      getActive: () => host.tool.getActive(),
      setActive: (toolNames) => host.tool.setActive(toolNames),
    },
    session: {
      getName: () => host.session.getName(),
      setName: (name) => host.session.setName(name),
      appendEntry: (customType, data) => host.session.appendEntry(customType, data),
      sendMessage(message, sendOptions) {
        void host.session.sendMessage(message, sendOptions);
      },
      sendUserMessage(content, sendOptions) {
        void host.session.sendUserMessage(content, sendOptions);
      },
    },
    platform: {
      get name() {
        return host.channel.platform;
      },
      get bot() {
        return host.platform.bot;
      },
      registerSpeakElement(definition) {
        assertActive();
        if (speakElements.has(definition.tag)) {
          throw new Error(`Speak element "${definition.tag}" is already registered by ${def.id}`);
        }
        speakElements.set(definition.tag, definition);
        const dispose = host.platform.registerSpeakElement(definition);
        speakElementDisposers.push(dispose);
        return dispose;
      },
    },
    on(event: string, handler: (...args: unknown[]) => unknown) {
      assertActive();
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
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
