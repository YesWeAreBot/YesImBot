import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { CorePlugin } from "../src/services/plugin/builtin/core";

describe("loadResource safety", () => {
  it("reads declared skill resource content for search/guide.txt", async () => {
    const skillDir = mkdtempSync(join(tmpdir(), "athena-skill-"));
    writeFileSync(join(skillDir, "guide.txt"), "guide content", "utf8");
    const plugin = new CorePlugin({
      on: vi.fn(),
      logger: vi.fn(() => ({ info: vi.fn() })),
      "yesimbot.plugin": { registerPlugin: vi.fn(), unregisterPlugin: vi.fn() },
      "yesimbot.skill": {
        get: vi.fn(() => ({
          name: "search",
          description: "Search skill",
          guidance: "Use search when freshness matters.",
          resources: { "guide.txt": { path: "guide.txt" } },
          rootDir: skillDir,
          source: "plugin",
        })),
      },
      "yesimbot.session": { getState: vi.fn() },
    } as never);

    const result = await plugin.loadResourceTool({ resourceId: "search/guide.txt" }, {} as never);
    if (!result.ok) {
      throw new Error(result.error ?? "loadResource should succeed");
    }

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      resourceId: "search/guide.txt",
      content: "guide content",
    });
  });

  it("rejects invalid resource identifier format", async () => {
    const plugin = new CorePlugin({
      on: vi.fn(),
      logger: vi.fn(() => ({ info: vi.fn() })),
      "yesimbot.plugin": { registerPlugin: vi.fn(), unregisterPlugin: vi.fn() },
      "yesimbot.skill": { get: vi.fn() },
      "yesimbot.session": { getState: vi.fn() },
    } as never);

    const result = await plugin.loadResourceTool({ resourceId: "search" }, {} as never);
    if (result.ok) {
      throw new Error("loadResource should fail for invalid resourceId format");
    }

    expect(result.ok).toBe(false);
    expect(result.error).toContain("resourceId must use the format <skill-name>/<store-key>");
  });

  it("rejects traversal input like search/../secret.txt", async () => {
    const skillDir = mkdtempSync(join(tmpdir(), "athena-skill-"));
    mkdirSync(join(skillDir, "docs"), { recursive: true });
    writeFileSync(join(skillDir, "docs", "guide.txt"), "guide content", "utf8");
    const plugin = new CorePlugin({
      on: vi.fn(),
      logger: vi.fn(() => ({ info: vi.fn() })),
      "yesimbot.plugin": { registerPlugin: vi.fn(), unregisterPlugin: vi.fn() },
      "yesimbot.skill": {
        get: vi.fn(() => ({
          name: "search",
          description: "Search skill",
          guidance: "Use search when freshness matters.",
          resources: { "../secret.txt": { path: "docs/guide.txt" } },
          rootDir: skillDir,
          source: "plugin",
        })),
      },
      "yesimbot.session": { getState: vi.fn() },
    } as never);

    const result = await plugin.loadResourceTool(
      { resourceId: "search/../secret.txt" },
      {} as never,
    );
    if (result.ok) {
      throw new Error("loadResource should reject traversal resourceId");
    }

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid resource path");
  });
});
