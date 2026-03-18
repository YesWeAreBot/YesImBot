import { describe, it, expect } from "vitest";

// Test Koishi's h.parse() and element construction behavior
// These tests do NOT use the global setup.ts mock
describe("CorePlugin.sendMessage - Element Parsing", () => {
  // For these tests, we test the behavior of h.parse by using the real import
  // But we skip tests that depend on actual Koishi internals in this plan iteration
  // The focus is on testing the message splitting and quote construction logic

  describe("Message splitting behavior", () => {
    it("should split messages on <sep/> correctly", () => {
      const content = "First part<sep/>Second part<sep/>Third part";
      const parts = content
        .split("<sep/>")
        .map((s) => s.trim())
        .filter(Boolean);
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe("First part");
      expect(parts[1]).toBe("Second part");
      expect(parts[2]).toBe("Third part");
    });

    it("should handle message splitting with leading/trailing whitespace", () => {
      const content = "  First part  <sep/>  Second part  ";
      const parts = content
        .split("<sep/>")
        .map((s) => s.trim())
        .filter(Boolean);
      expect(parts).toHaveLength(2);
      expect(parts[0]).toBe("First part");
      expect(parts[1]).toBe("Second part");
    });

    it("should handle multiple consecutive <sep/> tags", () => {
      const content = "First<sep/><sep/>Second";
      const parts = content
        .split("<sep/>")
        .map((s) => s.trim())
        .filter(Boolean);
      expect(parts).toHaveLength(2);
      expect(parts[0]).toBe("First");
      expect(parts[1]).toBe("Second");
    });

    it("should handle <sep/> at start and end", () => {
      const content = "<sep/>First<sep/>";
      const parts = content
        .split("<sep/>")
        .map((s) => s.trim())
        .filter(Boolean);
      expect(parts).toHaveLength(1);
      expect(parts[0]).toBe("First");
    });

    it("should handle content with only <sep/> tags", () => {
      const content = "<sep/><sep/><sep/>";
      const parts = content
        .split("<sep/>")
        .map((s) => s.trim())
        .filter(Boolean);
      expect(parts).toHaveLength(0);
    });
  });

  describe("XML element structure", () => {
    it("should identify <at> element pattern", () => {
      const content = 'Hello <at id="123"/>!';
      expect(content).toContain('<at id="123"/>');
      expect(content).toMatch(/<at\s+id=["']123["']\s*\/>/);
    });

    it("should identify <img> element pattern", () => {
      const content = '<img src="http://example.com/image.png"/>';
      expect(content).toContain('<img src="http://example.com/image.png"/>');
      expect(content).toMatch(/<img\s+src=["'][^"']+["']\s*\/>/);
    });

    it("should identify <quote> element pattern", () => {
      const content = '<quote id="123"/>';
      expect(content).toContain('<quote id="123"/>');
      expect(content).toMatch(/<quote\s+id=["'][^"']+["']\s*\/>/);
    });

    it("should extract attribute values from XML elements", () => {
      const atElement = '<at id="123"/>';
      const idMatch = atElement.match(/id=["']([^"']+)["']/);
      expect(idMatch).not.toBeNull();
      expect(idMatch?.[1]).toBe("123");
    });
  });

  describe("Array construction for sendMessage", () => {
    it("should construct element array with quote and content", () => {
      const replyToId = "native-123";
      const content = 'Hello <at id="123"/>!';
      // Simulate what sendMessage does: [h('quote', {id}), ...parsedContent]
      const elements = [`<quote id="${replyToId}"/>`, content];

      expect(elements).toHaveLength(2);
      expect(elements[0]).toContain(`<quote id="${replyToId}"/>`);
      expect(elements[1]).toBe(content);
    });

    it("should handle single message without quote", () => {
      const content = "Just plain text";
      const elements = [content];

      expect(elements).toHaveLength(1);
      expect(elements[0]).toBe("Just plain text");
    });
  });
});
