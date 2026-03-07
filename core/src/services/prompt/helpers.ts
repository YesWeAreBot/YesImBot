import type Handlebars from "handlebars";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * Register built-in helpers on a Handlebars instance.
 * Each helper is designed for prompt template rendering.
 */
export function registerBuiltinHelpers(hbs: typeof Handlebars): void {
  hbs.registerHelper("formatDate", (date: unknown) => {
    if (date instanceof Date) {
      return dateFormatter.format(date);
    }
    if (typeof date === "string" || typeof date === "number") {
      const parsed = new Date(date);
      if (!Number.isNaN(parsed.getTime())) {
        return dateFormatter.format(parsed);
      }
    }
    return String(date ?? "");
  });

  hbs.registerHelper("truncate", (str: unknown, len: unknown) => {
    const text = String(str ?? "");
    const maxLen = typeof len === "number" ? len : Number.parseInt(String(len), 10);
    if (Number.isNaN(maxLen) || text.length <= maxLen) {
      return text;
    }
    return text.slice(0, maxLen) + "...";
  });

  hbs.registerHelper("join", (arr: unknown, sep: unknown) => {
    if (!Array.isArray(arr)) return String(arr ?? "");
    const separator = typeof sep === "string" ? sep : ", ";
    return arr.join(separator);
  });

  hbs.registerHelper(
    "eq",
    function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
      if (a === b) {
        return options.fn(this);
      }
      return options.inverse(this);
    },
  );
}

/**
 * Registry for managing custom helpers on a Handlebars instance.
 * Allows plugins and extensions to register/unregister helpers.
 */
export class HelperRegistry {
  private registeredNames = new Set<string>();

  constructor(private readonly hbs: typeof Handlebars) {}

  register(name: string, fn: Handlebars.HelperDelegate): void {
    this.hbs.registerHelper(name, fn);
    this.registeredNames.add(name);
  }

  unregister(name: string): void {
    this.hbs.unregisterHelper(name);
    this.registeredNames.delete(name);
  }

  has(name: string): boolean {
    return this.registeredNames.has(name);
  }

  clear(): void {
    for (const name of this.registeredNames) {
      this.hbs.unregisterHelper(name);
    }
    this.registeredNames.clear();
  }
}
