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

import {
  getChannelStateDir,
  getUserStateDir,
} from "../../src/services/session/instruction-state/layout";
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

async function activateChannel(
  service: AgentSessionService,
  bot: Bot,
  messageId: string,
): Promise<void> {
  generateMock.mockResolvedValueOnce();
  await service.receive(
    createChannelMessageInput(bot, {
      messageId,
    }),
    bot,
  );
}

function createBotMock(selfId = "bot-self"): Bot {
  return {
    selfId,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Bot;
}

function createChannelMessageInput(bot: Bot, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: "channel_message" as const,
    platform: "discord",
    channelId: "channel-1",
    sender: {
      userId: "user-1",
      username: "alice",
      nickname: "Alice",
    },
    content: "hello",
    isDirect: false,
    atSelf: false,
    isReplyToBot: false,
    messageId: "settings-msg-1",
    timestamp: Date.now(),
    bot,
    ...overrides,
  };
}

function createExistingWorkspace(baseDir: string, channelId = "channel-1"): void {
  const globalRoot = join(baseDir, "athena");
  const channelStateDir = getChannelStateDir(globalRoot, "discord", channelId);
  const workspaceDir = join(channelStateDir, "workspace");
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
  writeFileSync(join(channelStateDir, "settings.json"), JSON.stringify({}, null, 2));
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
  it("creates state directories on the first user message without auto-creating settings or prompt files", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-settings-bootstrap-"));
    tempDirs.push(tempDir);

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "global-model",
      basePath: "athena",
    });
    const bot = createBotMock();

    await service.receive(createChannelMessageInput(bot), bot);

    const globalRoot = join(tempDir, "athena");
    const channelStateDir = getChannelStateDir(globalRoot, "discord", "channel-1");
    const stateRoot = join(globalRoot, "state");
    const globalInstructionsDir = join(stateRoot, "global", "instructions");
    const channelInstructionsDir = join(channelStateDir, "instructions");

    const globalSettingsPath = join(globalRoot, "settings.json");
    const channelSettingsPath = join(channelStateDir, "settings.json");

    expect(existsSync(globalRoot)).toBe(true);
    expect(existsSync(join(globalRoot, "discord-channel-1"))).toBe(false);
    expect(existsSync(globalInstructionsDir)).toBe(true);
    expect(existsSync(channelInstructionsDir)).toBe(true);
    expect(existsSync(globalSettingsPath)).toBe(false);
    expect(existsSync(channelSettingsPath)).toBe(false);
    expect(existsSync(join(globalRoot, "SOUL.md"))).toBe(false);
    expect(existsSync(join(globalRoot, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(channelStateDir, "workspace"))).toBe(false);
  });

  it("loads direct-message settings from the user state path only", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-settings-direct-user-state-"));
    tempDirs.push(tempDir);

    const globalRoot = join(tempDir, "athena");
    const userStateDir = getUserStateDir(globalRoot, "discord", "user-1");
    mkdirSync(userStateDir, { recursive: true });
    writeFileSync(
      join(userStateDir, "settings.json"),
      JSON.stringify({ response: { maxSteps: 2 } }),
      "utf8",
    );

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "global-model",
      basePath: "athena",
    });
    const bot = createBotMock();

    await service.receive(createChannelMessageInput(bot, { isDirect: true }), bot);

    const activeChannel = service.getActiveChannels()[0];
    const agent = activeChannel ? service.getAgent(activeChannel) : undefined;

    expect(agent?.getSettingsManager().getResponseSettings()?.maxSteps).toBe(2);
    expect(existsSync(getChannelStateDir(globalRoot, "discord", "channel-1"))).toBe(false);
    expect(existsSync(join(userStateDir, "session"))).toBe(true);
  });

  it("does not overwrite existing workspace files", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-settings-no-overwrite-"));
    tempDirs.push(tempDir);

    const globalRoot = join(tempDir, "athena");
    const channelStateDir = getChannelStateDir(globalRoot, "discord", "channel-1");
    const workspaceDir = join(channelStateDir, "workspace");
    mkdirSync(workspaceDir, { recursive: true });

    writeFileSync(
      join(channelStateDir, "settings.json"),
      JSON.stringify({ response: { maxSteps: 2 } }),
      "utf8",
    );
    writeFileSync(join(workspaceDir, "SOUL.md"), "workspace soul\n", "utf8");
    writeFileSync(join(workspaceDir, "AGENTS.md"), "workspace agents\n", "utf8");

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "global-model",
      basePath: "athena",
    });

    const bot = createBotMock();
    await activateChannel(service, bot, "settings-no-overwrite-msg-1");

    expect(readFileSync(join(channelStateDir, "settings.json"), "utf8")).toBe(
      JSON.stringify({ response: { maxSteps: 2 } }),
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

    const channelStateDir = getChannelStateDir(globalRoot, "discord", "channel-1");
    const workspaceDir = join(channelStateDir, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
      join(channelStateDir, "settings.json"),
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

    const bot = createBotMock();
    await activateChannel(service, bot, "settings-options-msg-1");
    const agent = service.getAgent("discord:channel-1");
    expect(agent).toBeDefined();
    const settingsManager = agent!.getSettingsManager();

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

    const channelStateDir = getChannelStateDir(globalRoot, "discord", "channel-1");
    const workspaceDir = join(channelStateDir, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
      join(channelStateDir, "settings.json"),
      JSON.stringify({ useGlobal: false, response: { maxSteps: 4 } }, null, 2),
      "utf8",
    );

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "fallback-model",
      basePath: "athena",
      maxSteps: 2,
    });

    const bot = createBotMock();
    await activateChannel(service, bot, "settings-use-global-msg-1");
    const agent = service.getAgent("discord:channel-1");
    expect(agent).toBeDefined();
    const settingsManager = agent!.getSettingsManager();

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

  it("restores an existing workspace channel on the first user message without speaking", async () => {
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

    await service.receive(
      createChannelMessageInput(bot, {
        content: "wake runtime",
        messageId: "settings-msg-restore-1",
      }),
      bot,
    );
    const runtime = service.getAgent("discord:channel-1");
    const timeline = runtime?.sessionManager.getTimeline() ?? [];

    expect(service.getActiveChannels()).toEqual(["discord:channel-1"]);
    expect(runtime).toBeDefined();
    expect(timeline).toEqual(
      expect.arrayContaining([
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
        expect.objectContaining({
          kind: "channel_message",
          message: expect.objectContaining({
            content: "wake runtime",
            messageId: "settings-msg-restore-1",
          }),
        }),
      ]),
    );
    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("surfaces restore failures on the first user message and leaves the channel inactive", async () => {
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

    await expect(service.receive(createChannelMessageInput(bot), bot)).rejects.toThrow(
      "settings broke",
    );
    expect(service.getActiveChannels()).toEqual([]);
    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
