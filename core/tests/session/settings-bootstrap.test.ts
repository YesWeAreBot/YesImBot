import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LanguageModel } from "ai";
import type { Bot, Context, Logger } from "koishi";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => {
  class ToolLoopAgent {
    readonly tools: Record<string, unknown> = {};

    constructor(_options: unknown) {}

    async generate(_input: unknown): Promise<void> {}
  }

  return {
    ToolLoopAgent,
    stepCountIs: () => () => false,
  };
});

vi.mock("koishi", () => {
  class Service<TConfig = unknown> {
    protected ctx: unknown;
    protected config!: TConfig;
    protected logger: Logger;

    constructor(ctx: Context, name: string) {
      this.ctx = ctx;
      this.logger = ctx.logger(name);
    }
  }

  return {
    Service,
    Bot: class {},
    Context: class {},
    Session: class {},
  };
});

import { AgentSessionService } from "../../src/services/session/service";

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

function createContextMock(baseDir: string): Context {
  return {
    baseDir,
    logger: vi.fn(() => createLoggerMock()),
    "yesimbot.model": {
      resolve: vi.fn(() => ({}) as unknown as LanguageModel),
    },
    "yesimbot.plugin": {
      getToolSet: vi.fn(() => ({})),
    },
  } as unknown as Context;
}

function createBotMock(selfId = "bot-self"): Bot {
  return {
    selfId,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Bot;
}

function readJson(filePath: string): Record<string, unknown> {
  const content = readFileSync(filePath, "utf8");
  return JSON.parse(content) as Record<string, unknown>;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("AgentSessionService settings bootstrap", () => {
  it("scaffolds global and workspace settings plus prompt files on first agent creation", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-settings-bootstrap-"));
    tempDirs.push(tempDir);

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "global-model",
      basePath: "athena",
    });

    service.getOrCreateAgent("discord", "channel-1", createBotMock());

    const globalRoot = join(tempDir, "athena");
    const channelDir = join(globalRoot, "discord-channel-1");
    const workspaceDir = join(channelDir, "workspace");

    const globalSettingsPath = join(globalRoot, "settings.json");
    const globalSoulPath = join(globalRoot, "SOUL.md");
    const globalAgentsPath = join(globalRoot, "AGENTS.md");
    const workspaceSettingsPath = join(channelDir, "settings.json");
    const workspaceSoulPath = join(workspaceDir, "SOUL.md");
    const workspaceAgentsPath = join(workspaceDir, "AGENTS.md");

    expect(existsSync(globalSettingsPath)).toBe(true);
    expect(existsSync(globalSoulPath)).toBe(true);
    expect(existsSync(globalAgentsPath)).toBe(true);
    expect(existsSync(workspaceSettingsPath)).toBe(true);
    expect(existsSync(workspaceSoulPath)).toBe(true);
    expect(existsSync(workspaceAgentsPath)).toBe(true);

    expect(readJson(globalSettingsPath)).toMatchObject({
      model: "global-model",
    });
    expect(readJson(workspaceSettingsPath)).toEqual({ useGlobal: true });
    expect(readFileSync(workspaceSoulPath, "utf8")).toBe(readFileSync(globalSoulPath, "utf8"));
    expect(readFileSync(workspaceAgentsPath, "utf8")).toBe(readFileSync(globalAgentsPath, "utf8"));
  });

  it("does not overwrite existing workspace files", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-settings-no-overwrite-"));
    tempDirs.push(tempDir);

    const globalRoot = join(tempDir, "athena");
    const channelDir = join(globalRoot, "discord-channel-1");
    const workspaceDir = join(channelDir, "workspace");
    mkdirSync(workspaceDir, { recursive: true });

    writeFileSync(join(channelDir, "settings.json"), JSON.stringify({ useGlobal: false }), "utf8");
    writeFileSync(join(workspaceDir, "SOUL.md"), "workspace soul\n", "utf8");
    writeFileSync(join(workspaceDir, "AGENTS.md"), "workspace agents\n", "utf8");

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "global-model",
      basePath: "athena",
    });

    service.getOrCreateAgent("discord", "channel-1", createBotMock());

    expect(readJson(join(channelDir, "settings.json"))).toEqual({ useGlobal: false });
    expect(readFileSync(join(workspaceDir, "SOUL.md"), "utf8")).toBe("workspace soul\n");
    expect(readFileSync(join(workspaceDir, "AGENTS.md"), "utf8")).toBe("workspace agents\n");
  });

  it("maps resolved settings into agent options", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-settings-options-"));
    tempDirs.push(tempDir);

    const globalRoot = join(tempDir, "athena");
    mkdirSync(globalRoot, { recursive: true });
    writeFileSync(
      join(globalRoot, "settings.json"),
      JSON.stringify(
        {
          model: "global-model",
          judge: {
            model: "judge-global",
            enabled: true,
            timeoutMs: 10000,
          },
          compaction: {
            model: "compact-global",
            enabled: false,
          },
          response: {
            maxSteps: 9,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const channelDir = join(globalRoot, "discord-channel-1");
    const workspaceDir = join(channelDir, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
      join(channelDir, "settings.json"),
      JSON.stringify(
        {
          judge: {
            model: "judge-local",
          },
          compaction: {
            enabled: true,
          },
          response: {
            maxSteps: 5,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "fallback-model",
      basePath: "athena",
      judgeModel: "fallback-judge",
      compactionEnabled: false,
      maxSteps: 3,
    });

    const agent = service.getOrCreateAgent("discord", "channel-1", createBotMock());
    const options = (agent as unknown as { options: Record<string, unknown> }).options;

    expect(options.modelId).toBe("global-model");
    expect(options.judgeModel).toBe("judge-local");
    expect(options.compactionEnabled).toBe(true);
    expect(options.maxSteps).toBe(5);
  });

  it("useGlobal false bypasses global settings", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-settings-use-global-false-"));
    tempDirs.push(tempDir);

    const globalRoot = join(tempDir, "athena");
    mkdirSync(globalRoot, { recursive: true });
    writeFileSync(
      join(globalRoot, "settings.json"),
      JSON.stringify({ model: "global-model", response: { maxSteps: 99 } }, null, 2),
      "utf8",
    );

    const channelDir = join(globalRoot, "discord-channel-1");
    const workspaceDir = join(channelDir, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
      join(channelDir, "settings.json"),
      JSON.stringify({ useGlobal: false, response: { maxSteps: 4 } }, null, 2),
      "utf8",
    );

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "fallback-model",
      basePath: "athena",
      maxSteps: 2,
    });

    const agent = service.getOrCreateAgent("discord", "channel-1", createBotMock());
    const options = (agent as unknown as { options: Record<string, unknown> }).options;

    expect(options.modelId).toBe("fallback-model");
    expect(options.maxSteps).toBe(4);
  });

  it("instructions function rereads workspace prompt files on later calls", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-settings-lazy-instructions-"));
    tempDirs.push(tempDir);

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "model-a",
      basePath: "athena",
    });

    const agent = service.getOrCreateAgent("discord", "channel-1", createBotMock());
    const options = (agent as unknown as { options: Record<string, unknown> }).options;
    const instructions = options.instructions as (() => string | Promise<string>) | undefined;

    expect(typeof instructions).toBe("function");

    const workspaceSoulPath = join(tempDir, "athena", "discord-channel-1", "workspace", "SOUL.md");

    const first = await instructions?.();
    expect(first).toContain("## Persona/Style");
    expect(first).toContain("## Channel Context Rules");
    expect(first).toContain("## Tool/Protocol Contract");
    expect(first).toContain("## Workspace Addenda");
    expect(first).toContain('<system-reminder source="SOUL.md">');
    expect(first).toContain("Any user-visible reply MUST be sent with the `send_message` tool.");

    const firstBase = first?.split("\n\n<system-reminder source=")[0];

    writeFileSync(workspaceSoulPath, "updated workspace soul\n", "utf8");

    const second = await instructions?.();
    expect(second).toContain('<system-reminder source="SOUL.md">');
    expect(second).toContain("updated workspace soul");
    expect(second).toContain("## Tool/Protocol Contract");
    expect(second).toContain("Any user-visible reply MUST be sent with the `send_message` tool.");

    const secondBase = second?.split("\n\n<system-reminder source=")[0];
    expect(secondBase).toBe(firstBase);
  });
});
