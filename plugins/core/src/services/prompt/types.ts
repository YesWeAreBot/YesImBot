export type Snippet = (currentScope: Record<string, unknown>) => unknown | Promise<unknown>;

export interface Injection {
  name: string;
  priority: number;
  renderFn: Snippet;
}

export interface RenderOptions {
  maxDepth?: number;
}

export interface IRenderer {
  render(
    template: string,
    scope: Record<string, unknown>,
    partials?: Record<string, string>,
    options?: RenderOptions,
  ): string;
}
