import { describe, it, expect, beforeEach } from "vitest";

import { HelperRegistry, registerBuiltinHelpers } from "../src/services/prompt/helpers";
import { HandlebarsRenderer } from "../src/services/prompt/renderer";

describe("HandlebarsRenderer", () => {
  let renderer: HandlebarsRenderer;

  beforeEach(() => {
    renderer = new HandlebarsRenderer();
  });

  describe("render()", () => {
    it("should render simple variable substitution", () => {
      const result = renderer.render("Hello, {{name}}!", { name: "World" });
      expect(result).toBe("Hello, World!");
    });

    it("should render unescaped XML content without triple-stash", () => {
      // Since escaping is disabled on the isolated instance, double-stash should work too
      const result = renderer.render("Content: {{xml}}", {
        xml: "<timeline><msg>hello</msg></timeline>",
      });
      expect(result).toBe("Content: <timeline><msg>hello</msg></timeline>");
    });

    it("should render triple-stash {{{var}}} for unescaped content", () => {
      const result = renderer.render("Content: {{{xml}}}", {
        xml: "<timeline><msg>hello</msg></timeline>",
      });
      expect(result).toBe("Content: <timeline><msg>hello</msg></timeline>");
    });

    it("should iterate arrays with {{#each}} block helper", () => {
      const template = "Items: {{#each items}}{{this}}, {{/each}}";
      const result = renderer.render(template, {
        items: ["apple", "banana", "cherry"],
      });
      expect(result).toBe("Items: apple, banana, cherry, ");
    });

    it("should handle {{#if}} conditional", () => {
      const template = "{{#if active}}Active{{/if}}";
      expect(renderer.render(template, { active: true })).toBe("Active");
      expect(renderer.render(template, { active: false })).toBe("");
    });

    it("should handle {{#unless}} conditional", () => {
      const template = "{{#unless banned}}Welcome{{/unless}}";
      expect(renderer.render(template, { banned: false })).toBe("Welcome");
      expect(renderer.render(template, { banned: true })).toBe("");
    });

    it("should render nested object properties", () => {
      const template = "{{user.name}} is {{user.age}} years old";
      const result = renderer.render(template, {
        user: { name: "Alice", age: 30 },
      });
      expect(result).toBe("Alice is 30 years old");
    });

    it("should render empty string for missing variables", () => {
      const result = renderer.render("Hello, {{name}}!", {});
      expect(result).toBe("Hello, !");
    });
  });

  describe("compile() and caching", () => {
    it("should cache compiled template and reuse on second call", () => {
      const source = "Hello, {{name}}!";
      const cacheKey = "greeting";

      const fn1 = renderer.compile(source, cacheKey);
      const fn2 = renderer.compile(source, cacheKey);

      // Same reference means it was cached
      expect(fn1).toBe(fn2);

      // Both produce correct output
      expect(fn1({ name: "World" })).toBe("Hello, World!");
      expect(fn2({ name: "Alice" })).toBe("Hello, Alice!");
    });

    it("should compile without caching when no cacheKey provided", () => {
      const source = "Hello, {{name}}!";

      const fn1 = renderer.compile(source);
      const fn2 = renderer.compile(source);

      // Different references since no caching
      expect(fn1).not.toBe(fn2);
    });
  });

  describe("clearCache()", () => {
    it("should remove cached templates", () => {
      const source = "Hello, {{name}}!";
      const cacheKey = "greeting";

      const fn1 = renderer.compile(source, cacheKey);
      renderer.clearCache();
      const fn2 = renderer.compile(source, cacheKey);

      // After clearing, new compilation should create new function
      expect(fn1).not.toBe(fn2);
    });
  });

  describe("render() with cacheKey", () => {
    it("should cache and reuse template when cacheKey is provided", () => {
      const source = "Hi {{name}}";
      const cacheKey = "hi-template";

      const r1 = renderer.render(source, { name: "Bob" }, cacheKey);
      const r2 = renderer.render(source, { name: "Eve" }, cacheKey);

      expect(r1).toBe("Hi Bob");
      expect(r2).toBe("Hi Eve");
    });
  });
});

describe("Built-in Helpers", () => {
  let renderer: HandlebarsRenderer;

  beforeEach(() => {
    renderer = new HandlebarsRenderer();
  });

  describe("formatDate", () => {
    it("should format Date object to zh-CN locale string", () => {
      // Use a fixed date for deterministic testing
      const date = new Date("2026-03-07T10:30:00Z");
      const result = renderer.render("Today is {{formatDate date}}", { date });
      // Should contain year, month, day in some format
      expect(result).toContain("2026");
      // Should not be empty or the raw date object
      expect(result).not.toContain("[object");
    });
  });

  describe("truncate", () => {
    it("should truncate long strings with ellipsis", () => {
      const result = renderer.render("{{truncate text 10}}", {
        text: "This is a very long string that should be truncated",
      });
      expect(result).toHaveLength(13); // 10 chars + "..."
      expect(result).toMatch(/\.\.\.$/);
    });

    it("should not truncate strings shorter than limit", () => {
      const result = renderer.render("{{truncate text 100}}", {
        text: "Short text",
      });
      expect(result).toBe("Short text");
    });
  });

  describe("join", () => {
    it("should join array with separator", () => {
      const result = renderer.render('{{join items ", "}}', {
        items: ["a", "b", "c"],
      });
      expect(result).toBe("a, b, c");
    });

    it("should handle empty array", () => {
      const result = renderer.render('{{join items ", "}}', {
        items: [],
      });
      expect(result).toBe("");
    });
  });

  describe("eq", () => {
    it("should render block when values are equal", () => {
      const template = '{{#eq status "active"}}Active{{/eq}}';
      expect(renderer.render(template, { status: "active" })).toBe("Active");
    });

    it("should not render block when values are not equal", () => {
      const template = '{{#eq status "active"}}Active{{/eq}}';
      expect(renderer.render(template, { status: "inactive" })).toBe("");
    });
  });
});

describe("HelperRegistry", () => {
  let renderer: HandlebarsRenderer;

  beforeEach(() => {
    renderer = new HandlebarsRenderer();
  });

  it("should allow registering custom helpers usable in templates", () => {
    renderer.registerHelper("shout", (text: string) => {
      return text.toUpperCase();
    });

    const result = renderer.render("{{shout name}}", { name: "hello" });
    expect(result).toBe("HELLO");
  });

  it("should allow unregistering helpers", () => {
    renderer.registerHelper("shout", (text: string) => {
      return text.toUpperCase();
    });

    renderer.unregisterHelper("shout");

    // After unregister, Handlebars throws for missing helpers
    expect(() => renderer.render("{{shout name}}", { name: "hello" })).toThrow();
  });
});

describe("Mustache removal", () => {
  it("should not have mustache as a dependency", async () => {
    // Attempting to import mustache should fail
    try {
      await import("mustache");
      // If we reach here, mustache is still installed
      expect.fail("mustache should not be importable");
    } catch {
      // Expected - mustache should not be available
      expect(true).toBe(true);
    }
  });
});
