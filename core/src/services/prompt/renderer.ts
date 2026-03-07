import Handlebars from "handlebars";

import { HelperRegistry, registerBuiltinHelpers } from "./helpers";

/**
 * Handlebars-based template renderer with precompilation caching.
 *
 * Uses an isolated Handlebars instance (via Handlebars.create()) to prevent
 * helper/partial leaks between tests and production. HTML escaping is disabled
 * since all prompt content needs unescaped rendering (XML tags like <timeline>, <msg>).
 */
export class HandlebarsRenderer {
  private readonly hbs: typeof Handlebars;
  private readonly templateCache = new Map<string, HandlebarsTemplateDelegate>();
  private readonly registry: HelperRegistry;

  constructor() {
    // Create isolated instance to avoid global pollution
    this.hbs = Handlebars.create();

    // Disable HTML escaping — prompts are not user-facing HTML.
    // Coerce undefined/null to empty string (missing variables produce empty output)
    // Handlebars passes the raw value (which may be undefined) to escapeExpression
    this.hbs.Utils.escapeExpression = (str) => {
      if (str == null) return "";
      return String(str);
    };

    // Register built-in helpers
    registerBuiltinHelpers(this.hbs);

    // Create helper registry for custom helpers
    this.registry = new HelperRegistry(this.hbs);
  }

  /**
   * Compile a template source string, optionally caching the compiled function.
   * When a cacheKey is provided and a cached version exists, the cached function is returned.
   */
  compile(source: string, cacheKey?: string): HandlebarsTemplateDelegate {
    if (cacheKey) {
      const cached = this.templateCache.get(cacheKey);
      if (cached) return cached;
    }

    const compiled = this.hbs.compile(source);

    if (cacheKey) {
      this.templateCache.set(cacheKey, compiled);
    }

    return compiled;
  }

  /**
   * Render a template with the given context.
   * When a cacheKey is provided, the compiled template is cached for reuse.
   */
  render(source: string, context: Record<string, unknown>, cacheKey?: string): string {
    const template = this.compile(source, cacheKey);
    return template(context);
  }

  /**
   * Flush all cached compiled templates.
   */
  clearCache(): void {
    this.templateCache.clear();
  }

  /**
   * Register a custom helper on this renderer's Handlebars instance.
   */
  registerHelper(name: string, fn: (...args: unknown[]) => unknown): void {
    this.registry.register(name, fn as Handlebars.HelperDelegate);
  }

  /**
   * Unregister a custom helper.
   */
  unregisterHelper(name: string): void {
    this.registry.unregister(name);
  }

  /**
   * Register a partial template.
   */
  registerPartial(name: string, content: string): void {
    this.hbs.registerPartial(name, content);
  }

  /**
   * Unregister a partial template.
   */
  unregisterPartial(name: string): void {
    this.hbs.unregisterPartial(name);
  }
}
