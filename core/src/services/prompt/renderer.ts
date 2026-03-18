import Mustache from "mustache";

import type { RenderOptions } from "./types";

Mustache.escape = (text) => text;

export class MustacheRenderer {
  parse(template: string): { variables: Set<string>; partials: Set<string> } {
    const tokens = Mustache.parse(template);
    const variables = new Set<string>();
    const partials = new Set<string>();
    const traverse = (toks: unknown[][]) => {
      for (const t of toks) {
        if (t[0] === "name" || t[0] === "#" || t[0] === "^" || t[0] === "&") {
          variables.add(t[1] as string);
        } else if (t[0] === ">") {
          partials.add(t[1] as string);
        }
        if (t[4] && Array.isArray(t[4])) traverse(t[4] as unknown[][]);
      }
    };
    traverse(tokens as unknown[][]);
    return { variables, partials };
  }

  render(
    template: string,
    scope: Record<string, unknown>,
    partials?: Record<string, string>,
    options?: RenderOptions,
  ): string {
    const maxDepth = options?.maxDepth ?? 3;
    let output = template;
    let prev = "";
    let depth = 0;
    while (output !== prev && depth < maxDepth) {
      prev = output;
      output = Mustache.render(prev, scope, partials);
      depth++;
    }
    return output;
  }
}
