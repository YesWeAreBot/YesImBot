import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(process.cwd(), "..");

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf-8");
}

describe("extension plugin registration awaits reload summaries", () => {
  it("workspace awaits registration and unregistration", () => {
    const source = readRepoFile("plugins/workspace/src/index.ts");

    expect(source).toContain('await this.ctx["yesimbot.extension"].registerExtension');
    expect(source).toContain(
      'await this.ctx["yesimbot.extension"].unregisterExtension("workspace")',
    );
  });

  it("mcp-client awaits registration and unregistration", () => {
    const source = readRepoFile("plugins/mcp-client/src/index.ts");

    expect(source).toContain('await this.ctx["yesimbot.extension"].registerExtension');
    expect(source).toContain(
      'await this.ctx["yesimbot.extension"].unregisterExtension("mcp-client")',
    );
  });

  it("skill awaits registration and unregistration", () => {
    const source = readRepoFile("plugins/skill/src/index.ts");

    expect(source).toContain('await this.ctx["yesimbot.extension"].registerExtension');
    expect(source).toContain('await this.ctx["yesimbot.extension"].unregisterExtension("skill")');
  });

  it("chat-history awaits registration and unregistration", () => {
    const source = readRepoFile("core/src/extension/built-in/chat-history/index.ts");

    expect(source).toContain('await this.ctx["yesimbot.extension"].registerExtension');
    expect(source).toContain(
      'await this.ctx["yesimbot.extension"].unregisterExtension("chat-history")',
    );
  });
});
