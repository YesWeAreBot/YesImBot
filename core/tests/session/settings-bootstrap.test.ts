import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LanguageModel } from "ai";
import type { Bot, Context, Logger } from "koishi";
import { afterEach, describe, expect, it, vi } from "vitest";

const generateMock = vi.fn<(input: unknown) => Promise<void>>();

vi.mock("ai", () => {
  class ToolLoopAgent {
    readonly tools: Record<string, unknown> = {};

    constructor(_options: unknown) {}

    async generate(input: unknown): Promise<void> {
      return generateMock(input);
    }
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

import { getChannelStateDir } from "../../src/services/session/instruction-state/layout";
import { AgentSessionService } from "../../src/services/session/service";
import { SessionManager } from "../../src/services/session/session-manager";

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
      resolveRegistration: vi.fn((fullId: string) => ({
        fullId,
        providerId: "test",
        modelId: "model",
        entry: {
          id: "model",
          toolCall: true,
          reasoning: false,
        },
        model: {} as unknown as LanguageModel,
      })),
      resolve: vi.fn(() => ({}) as unknown as LanguageModel),
    },
    "yesimbot.plugin": {
      getToolSet: vi.fn(() => ({})),
    },
  } as unknown as Context;
}

function createContextWithLogger(baseDir: string): { ctx: Context; logger: Logger } {
  const logger = createLoggerMock();
  return {
    ctx: {
      baseDir,
      logger: vi.fn(() => logger),
      "yesimbot.model": {
        resolveRegistration: vi.fn((fullId: string) => ({
          fullId,
          providerId: "test",
          modelId: "model",
          entry: {
            id: "model",
            toolCall: true,
            reasoning: false,
          },
          model: {} as unknown as LanguageModel,
        })),
        resolve: vi.fn(() => ({}) as unknown as LanguageModel),
      },
      "yesimbot.plugin": {
        getToolSet: vi.fn(() => ({})),
      },
    } as unknown as Context,
    logger,
  };
}

function createBotMock(selfId = "bot-self"): Bot {
  return {
    selfId,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Bot;
}

function createExistingWorkspace(baseDir: string, channelId = "channel-1"): void {
  const globalRoot = join(baseDir, "athena");
  const channelDir = join(globalRoot, `discord-${channelId}`);
  const workspaceDir = join(channelDir, "workspace");
  const stateRoot = join(globalRoot, "state");

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(stateRoot, "global", "instructions"), { recursive: true });
  mkdirSync(join(stateRoot, "channels", "discord", "Y2hhbm5lbC0x", "instructions"), {
    recursive: true,
  });
  writeFileSync(
    join(globalRoot, "settings.json"),
    JSON.stringify({ model: "global-model" }, null, 2),
  );
  writeFileSync(join(channelDir, "settings.json"), JSON.stringify({ useGlobal: true }, null, 2));
  writeFileSync(join(workspaceDir, "SOUL.md"), "workspace soul\n", "utf8");
  writeFileSync(join(workspaceDir, "AGENTS.md"), "workspace agents\n", "utf8");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
  generateMock.mockReset();
  vi.restoreAllMocks();
});

describe("AgentSessionService settings bootstrap", () => {
  it("creates channel and instruction-state directories without auto-creating settings or prompt files", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-settings-bootstrap-"));
    tempDirs.push(tempDir);

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "global-model",
      basePath: "athena",
    });

    await service.getOrCreateAgent("discord", "channel-1", createBotMock());

    const globalRoot = join(tempDir, "athena");
    const channelDir = join(globalRoot, "discord-channel-1");
    const stateRoot = join(globalRoot, "state");
    const globalInstructionsDir = join(stateRoot, "global", "instructions");
    const channelInstructionsDir = join(
      stateRoot,
      "channels",
      "discord",
      "Y2hhbm5lbC0x",
      "instructions",
    );

    const globalSettingsPath = join(globalRoot, "settings.json");
    const channelSettingsPath = join(channelDir, "settings.json");

    expect(existsSync(globalRoot)).toBe(true);
    expect(existsSync(channelDir)).toBe(true);
    expect(existsSync(globalInstructionsDir)).toBe(true);
    expect(existsSync(channelInstructionsDir)).toBe(true);
    expect(existsSync(globalSettingsPath)).toBe(false);
    expect(existsSync(channelSettingsPath)).toBe(false);
    expect(existsSync(join(globalRoot, "SOUL.md"))).toBe(false);
    expect(existsSync(join(globalRoot, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(channelDir, "workspace"))).toBe(false);
  });

  it("does not overwrite existing workspace files", async () => {
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

    await service.getOrCreateAgent("discord", "channel-1", createBotMock());

    expect(readFileSync(join(channelDir, "settings.json"), "utf8")).toBe(
      JSON.stringify({ useGlobal: false }),
    );
    expect(readFileSync(join(workspaceDir, "SOUL.md"), "utf8")).toBe("workspace soul\n");
    expect(readFileSync(join(workspaceDir, "AGENTS.md"), "utf8")).toBe("workspace agents\n");
  });

  it("exposes resolved settings through the channel settings manager", async () => {
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

    const agent = await service.getOrCreateAgent("discord", "channel-1", createBotMock());
    const settingsManager = agent.getSettingsManager();

    expect(settingsManager.getModel()).toBe("global-model");
    expect(settingsManager.getJudgeSettings()?.model).toBe("judge-local");
    expect(settingsManager.getCompactionSettings()?.enabled).toBe(true);
    expect(settingsManager.getResponseSettings()?.maxSteps).toBe(5);
  });

  it("ignores deprecated useGlobal and still applies global plus workspace overrides", async () => {
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

    const agent = await service.getOrCreateAgent("discord", "channel-1", createBotMock());
    const settingsManager = agent.getSettingsManager();

    expect(settingsManager.getModel()).toBe("global-model");
    expect(settingsManager.getResponseSettings()?.maxSteps).toBe(4);
    expect(settingsManager.getReloadMetadata().issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "deprecated-key",
          path: "useGlobal",
        }),
      ]),
    );
  });

  it("bootstraps an existing workspace channel before the first user message without speaking", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-pre-message-bootstrap-"));
    tempDirs.push(tempDir);
    createExistingWorkspace(tempDir);

    const sessionDir = join(
      getChannelStateDir(join(tempDir, "athena"), "discord", "channel-1"),
      "session",
    );
    const seededSession = SessionManager.create("discord:channel-1", sessionDir, "global-model");
    seededSession.appendTimelineRecord({
      id: "persisted-channel-message",
      kind: "channel_message",
      timestamp: 100,
      stage: "ingress",
      visibility: "model",
      materialization: "default",
      message: {
        kind: "channel_message",
        platform: "discord",
        channelId: "channel-1",
        messageId: "persisted-msg-1",
        timestamp: 100,
        content: "persisted hello before restart",
        sender: {
          userId: "user-1",
          username: "alice",
          nickname: "Alice",
        },
        isDirect: false,
        atSelf: false,
        isReplyToBot: false,
      },
    });
    seededSession.appendTimelineRecord({
      id: "persisted-response-status",
      kind: "system_notice",
      timestamp: 101,
      stage: "runtime",
      visibility: "hidden",
      materialization: "hidden",
      subType: "response_status_exception",
      materializationKey: "response_status",
      notice: "step failed",
      data: {
        endReason: "exception",
        nextAction: "idle",
        durationMs: 12,
        stepsCompleted: 1,
        error: "seeded failure",
      },
    });

    const bot = createBotMock();
    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "global-model",
      basePath: "athena",
    });

    const result = await service.bootstrapChannelForManagement("discord", "channel-1", bot);
    const runtime = service.getAgent("discord:channel-1");
    const timeline = runtime?.sessionManager.getTimeline() ?? [];

    expect(result).toMatchObject({
      channelKey: "discord:channel-1",
      status: "restored",
    });
    expect(service.getActiveChannels()).toEqual(["discord:channel-1"]);
    expect(runtime).toBeDefined();
    expect(timeline).toEqual([
      expect.objectContaining({
        kind: "channel_message",
        message: expect.objectContaining({
          content: "persisted hello before restart",
        }),
      }),
      expect.objectContaining({
        kind: "system_notice",
        materializationKey: "response_status",
        data: expect.objectContaining({
          error: "seeded failure",
          endReason: "exception",
        }),
      }),
    ]);
    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("keeps bootstrap failures channel-local and logs the channel identifier", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-pre-message-failure-"));
    tempDirs.push(tempDir);
    createExistingWorkspace(tempDir);

    const { ctx, logger } = createContextWithLogger(tempDir);
    const bot = createBotMock();
    const service = new AgentSessionService(ctx, {
      model: "global-model",
      basePath: "athena",
    });

    vi.spyOn(SessionManager, "restoreOrCreateRecent").mockImplementationOnce(() => {
      throw new Error("settings broke");
    });

    const result = await service.bootstrapChannelForManagement("discord", "channel-1", bot);

    expect(result).toMatchObject({
      channelKey: "discord:channel-1",
      status: "failed",
      error: "settings broke",
    });
    expect(service.getActiveChannels()).toEqual([]);
    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("discord:channel-1"),
      expect.any(Error),
    );
  });
});
