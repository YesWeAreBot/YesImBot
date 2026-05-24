import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("agent package boundary", () => {
  it("does not contain extension lifecycle terms", () => {
    const root = join(process.cwd(), "src", "session");
    const content = files(root)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(content).not.toContain("ExtensionRunner");
    expect(content).not.toContain("ExtensionRegistry");
    expect(content).not.toContain("ExtensionDefinition");
    expect(content).not.toContain("ExtensionAPI");
    expect(content).not.toContain("createExtensionRuntime");
  });
});
