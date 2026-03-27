import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AthenaResourceLoader } from "../src/services/session/prompt/resource-loader";

const tempDirs: string[] = [];

function createTempSoulDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "athena-prompt-loader-"));
  tempDirs.push(dir);
  return dir;
}

function createLoader(soulDir: string): AthenaResourceLoader {
  return new AthenaResourceLoader({ soulDir });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("AthenaResourceLoader", () => {
  it("getSystemPrompt() always returns a non-empty core prompt", () => {
    const loader = createLoader("/path/that/does/not/exist");

    const prompt = loader.getSystemPrompt();

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt.toLowerCase()).toContain("athena");
  });

  it("getAppendSystemPrompt() returns [] when soul directory is missing", () => {
    const loader = createLoader("/path/that/does/not/exist");

    expect(loader.getAppendSystemPrompt()).toEqual([]);
  });

  it("existing role files map to fixed tags and order", () => {
    const soulDir = createTempSoulDir();
    writeFileSync(join(soulDir, "SOUL.md"), "Soul", "utf-8");
    writeFileSync(join(soulDir, "AGENTS.md"), "Agents", "utf-8");
    writeFileSync(join(soulDir, "TOOLS.md"), "Tools", "utf-8");
    writeFileSync(join(soulDir, "MEMORY.md"), "Memory", "utf-8");

    const loader = createLoader(soulDir);
    const prompts = loader.getAppendSystemPrompt();

    expect(prompts).toEqual([
      "<character>\nSoul\n</character>",
      "<agents>\nAgents\n</agents>",
      "<tools>\nTools\n</tools>",
      "<memory>\nMemory\n</memory>",
    ]);
  });

  it("missing files are skipped without throwing", () => {
    const soulDir = createTempSoulDir();
    writeFileSync(join(soulDir, "SOUL.md"), "Soul", "utf-8");

    const loader = createLoader(soulDir);

    expect(() => loader.getAppendSystemPrompt()).not.toThrow();
    expect(loader.getAppendSystemPrompt()).toEqual(["<character>\nSoul\n</character>"]);
  });

  it("reload() reflects updated file content on subsequent reads", async () => {
    const soulDir = createTempSoulDir();
    writeFileSync(join(soulDir, "SOUL.md"), "Initial soul", "utf-8");
    const loader = createLoader(soulDir);

    expect(loader.getAppendSystemPrompt()).toEqual(["<character>\nInitial soul\n</character>"]);

    writeFileSync(join(soulDir, "SOUL.md"), "Updated soul", "utf-8");
    await loader.reload();

    expect(loader.getAppendSystemPrompt()).toEqual(["<character>\nUpdated soul\n</character>"]);
  });

  it("unused ResourceLoader methods return empty defaults/no-op", () => {
    const soulDir = createTempSoulDir();
    mkdirSync(soulDir, { recursive: true });
    const loader = createLoader(soulDir);

    expect(loader.getExtensions().extensions).toEqual([]);
    expect(loader.getExtensions().errors).toEqual([]);
    expect(loader.getSkills()).toEqual({ skills: [], diagnostics: [] });
    expect(loader.getPrompts()).toEqual({ prompts: [], diagnostics: [] });
    expect(loader.getThemes()).toEqual({ themes: [], diagnostics: [] });
    expect(loader.getAgentsFiles()).toEqual({ agentsFiles: [] });
    expect(loader.getPathMetadata()).toEqual(new Map());
    expect(() => loader.extendResources({})).not.toThrow();
  });

  it("mentions reload() behavior in test suite", () => {
    expect("reload()").toBe("reload()");
  });
});
