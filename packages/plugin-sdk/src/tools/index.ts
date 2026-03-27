import { ToolDecoratorEntry, ToolDecoratorOptions, YesImToolDefinition } from "./types";

export * from "./types";

export function YesImTool<INPUT = unknown, OUTPUT = unknown>(
  options: YesImToolDefinition<INPUT, OUTPUT>,
): YesImToolDefinition<INPUT, OUTPUT> {
  return options;
}

export const TOOL_DECORATOR_KEY = Symbol("yesimbot.plugin.tools");

export function Tool(options: ToolDecoratorOptions): MethodDecorator {
  return (target, propertyKey) => {
    const proto = target as Record<PropertyKey, unknown>;
    const existing = proto[TOOL_DECORATOR_KEY] as ToolDecoratorEntry[] | undefined;
    const entry: ToolDecoratorEntry = {
      ...options,
      methodKey: String(propertyKey),
    };
    if (existing) {
      existing.push(entry);
      return;
    }
    Reflect.defineProperty(proto, TOOL_DECORATOR_KEY, {
      value: [entry],
      enumerable: false,
    });
  };
}
