import type { UserContent } from "@yesimbot/agent/ai";

import type { AthenaEvent, EventFormatter, FormatterContext, FormatterRegistry } from "./types.js";

export function createFormatterRegistry(): FormatterRegistry {
  const formatters = new Map<string, EventFormatter[]>();

  return {
    register(kind: string, formatter: EventFormatter): () => void {
      if (!formatters.has(kind)) {
        formatters.set(kind, []);
      }
      formatters.get(kind)!.push(formatter);

      return () => {
        const stack = formatters.get(kind);
        if (stack) {
          const idx = stack.lastIndexOf(formatter);
          if (idx !== -1) stack.splice(idx, 1);
          if (stack.length === 0) formatters.delete(kind);
        }
      };
    },

    async format(event: AthenaEvent, ctx: FormatterContext): Promise<UserContent | null> {
      const stack = formatters.get(event.kind);
      if (!stack || stack.length === 0) return null;
      // Use the last registered formatter (highest priority)
      const formatter = stack[stack.length - 1];
      return formatter(event, ctx);
    },
  };
}
