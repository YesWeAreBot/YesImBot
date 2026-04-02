import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Logger } from "koishi";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DefaultSessionResourceLoader } from "../../src/services/session/resource-loader";
import { SettingsManager } from "../../src/services/session/settings-manager";

const tempDirs: string[] = [];

function createLoggerMock(): Logger {
  return {
    level: 2,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createLoaderSetup(settings: Record<string, unknown> = {}): {
  channelDir: string;
  loader: DefaultSessionResourceLoader;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "athena-system-prompt-loader-"));
  tempDirs.push(tempDir);

  const channelDir = join(tempDir, "discord-channel-1");
  const workspaceDir = join(channelDir, "workspace");
  mkdirSync(workspaceDir, { recursive: true });

  const settingsPath = join(channelDir, "settings.json");
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");

  const settingsManager = new SettingsManager({
    globalSettingsPath: join(tempDir, "settings.json"),
    workspaceSettingsPath: settingsPath,
  });
  const loader = new DefaultSessionResourceLoader({
    channelDir,
    settingsManager,
    logger: createLoggerMock(),
  });

  return { channelDir, loader };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("DefaultSessionResourceLoader system prompt assembly", () => {
  it("uses built-in prompt text and appends configured resources in deterministic order", () => {
    const { channelDir, loader } = createLoaderSetup({
      prompts: {
        builtInInstructions: "builtin prompt line",
        attachedInstructionFiles: ["AGENTS.md", "SOUL.md", "CUSTOM.md"],
      },
    });
    const workspaceDir = join(channelDir, "workspace");

    writeFileSync(join(workspaceDir, "AGENTS.md"), "agents rules\n", "utf8");
    writeFileSync(join(workspaceDir, "SOUL.md"), "soul persona\n", "utf8");
    writeFileSync(join(workspaceDir, "CUSTOM.md"), "custom addenda\n", "utf8");

    loader.reload();

    const prompt = loader.buildSystemPrompt();
    expect(prompt).toContain("builtin prompt line");
    expect(prompt).toContain("## Project Context");
    expect(prompt).toContain("### AGENTS.md");
    expect(prompt).toContain("### SOUL.md");
    expect(prompt).toContain("### CUSTOM.md");
    expect(prompt).toContain("agents rules");
    expect(prompt).toContain("soul persona");
    expect(prompt).toContain("custom addenda");
    expect(prompt).not.toContain("<system-reminder");

    const agentsIdx = prompt.indexOf("agents rules");
    const soulIdx = prompt.indexOf("soul persona");
    const customIdx = prompt.indexOf("custom addenda");
    expect(agentsIdx).toBeGreaterThanOrEqual(0);
    expect(soulIdx).toBeGreaterThan(agentsIdx);
    expect(customIdx).toBeGreaterThan(soulIdx);
  });

  it("skips empty resource files when appending prompt content", () => {
    const { channelDir, loader } = createLoaderSetup({
      prompts: {
        attachedInstructionFiles: ["SOUL.md", "AGENTS.md"],
      },
    });
    const workspaceDir = join(channelDir, "workspace");

    writeFileSync(join(workspaceDir, "SOUL.md"), "   \n", "utf8");
    writeFileSync(join(workspaceDir, "AGENTS.md"), "agents rules\n", "utf8");

    loader.reload();

    const prompt = loader.buildSystemPrompt();
    expect(prompt).not.toContain("<system-reminder");
    expect(prompt).not.toContain("SOUL.md");
    expect(prompt).toContain("## Project Context");
    expect(prompt).toContain("### AGENTS.md");
    expect(prompt).toContain("agents rules");
  });
});
