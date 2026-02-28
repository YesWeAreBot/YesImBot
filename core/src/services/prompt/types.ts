export type InjectionPoint = "soul" | "instructions" | "extra";

export const INJECTION_POINTS: InjectionPoint[] = ["soul", "instructions", "extra"];

export interface InjectionEntry {
  name: string;
  renderFn: (scope: Record<string, unknown>) => string | Promise<string>;
  before?: string;
  after?: string;
}

export interface Section {
  name: string;
  content: string;
  cacheable?: boolean;
}

export type Snippet = (currentScope: Record<string, unknown>) => unknown | Promise<unknown>;

export interface RenderOptions {
  maxDepth?: number;
}
