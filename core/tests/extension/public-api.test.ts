import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("extension public API boundary", () => {
  it("exports the current extension context vocabulary", () => {
    const entrypoint = readFileSync(join(process.cwd(), "src", "index.ts"), "utf-8");

    expect(entrypoint).toContain("ExtensionContext");
    expect(entrypoint).toContain("Channel");
    expect(entrypoint).toContain("ExtensionDefinition");
    expect(entrypoint).toContain("ToolDefinition");
  });

  it("does not export old extension runner or host vocabulary", () => {
    const entrypoint = readFileSync(join(process.cwd(), "src", "index.ts"), "utf-8");

    expect(entrypoint).not.toContain("ExtensionAPI");
    expect(entrypoint).not.toContain("ExtensionHost");
    expect(entrypoint).not.toContain("ChannelContext");
    expect(entrypoint).not.toContain("ExtensionRunner");
    expect(entrypoint).not.toContain("ExtensionRegistry");
  });
});
