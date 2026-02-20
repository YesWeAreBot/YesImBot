import Mustache from "mustache";

import type { IRenderer, RenderOptions } from "./types";

export class MustacheRenderer implements IRenderer {
  render(
    template: string,
    scope: Record<string, unknown>,
    partials?: Record<string, string>,
    _options?: RenderOptions,
  ): string {
    Mustache.escape = (text) => text;
    return Mustache.render(template, scope, partials);
  }
}
