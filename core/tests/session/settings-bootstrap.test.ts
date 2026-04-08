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

import { DefaultSessionResourceLoader } from "../../src/services/session/resource-loader";
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

  mkdirSync(workspaceDir, { recursive: true });
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
  it("scaffolds prompt files without auto-creating settings.json", () => {
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

    expect(existsSync(globalSettingsPath)).toBe(false);
    expect(existsSync(globalSoulPath)).toBe(true);
    expect(existsSync(globalAgentsPath)).toBe(true);
    expect(existsSync(workspaceSettingsPath)).toBe(false);
    expect(existsSync(workspaceSoulPath)).toBe(true);
    expect(existsSync(workspaceAgentsPath)).toBe(true);

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

    expect(readFileSync(join(channelDir, "settings.json"), "utf8")).toBe(
      JSON.stringify({ useGlobal: false }),
    );
    expect(readFileSync(join(workspaceDir, "SOUL.md"), "utf8")).toBe("workspace soul\n");
    expect(readFileSync(join(workspaceDir, "AGENTS.md"), "utf8")).toBe("workspace agents\n");
  });

  it("exposes resolved settings through the channel settings manager", () => {
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
    const settingsManager = agent.getSettingsManager();

    expect(settingsManager.getModel()).toBe("global-model");
    expect(settingsManager.getJudgeSettings()?.model).toBe("judge-local");
    expect(settingsManager.getCompactionSettings()?.enabled).toBe(true);
    expect(settingsManager.getResponseSettings()?.maxSteps).toBe(5);
  });

  it("ignores deprecated useGlobal and still applies global plus workspace overrides", () => {
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

  it("resource loader rereads workspace prompt files on reload", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-settings-lazy-resources-"));
    tempDirs.push(tempDir);

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "model-a",
      basePath: "athena",
    });

    const agent = service.getOrCreateAgent("discord", "channel-1", createBotMock());
    const channelDir = join(tempDir, "athena", "discord-channel-1");
    const loader = new DefaultSessionResourceLoader({
      channelDir,
      settingsManager: agent.getSettingsManager(),
      logger: createLoggerMock(),
    });

    const workspaceSoulPath = join(tempDir, "athena", "discord-channel-1", "workspace", "SOUL.md");

    loader.reload();
    const firstPrompt = loader.buildSystemPrompt();
    expect(firstPrompt).toContain("send_message");
    expect(firstPrompt).toContain("request_heartbeat");
    expect(firstPrompt).toContain("已经完成当前任务，就不要请求 heartbeat");
    expect(firstPrompt).toContain("## Project Context");
    expect(firstPrompt).toContain("### SOUL.md");
    expect(firstPrompt).not.toContain("<system-reminder");

    const firstBuiltIn = loader.getSystemPrompt();

    writeFileSync(workspaceSoulPath, "updated workspace soul\n", "utf8");

    loader.reload();
    const secondPrompt = loader.buildSystemPrompt();
    expect(secondPrompt).toContain("updated workspace soul");
    expect(secondPrompt).toContain("send_message");
    expect(secondPrompt).not.toContain("<system-reminder");
    expect(loader.getSystemPrompt()).toBe(firstBuiltIn);
  });

  it("loads configured attached instruction files from settings", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-settings-custom-resource-files-"));
    tempDirs.push(tempDir);

    const globalRoot = join(tempDir, "athena");
    const channelDir = join(globalRoot, "discord-channel-1");
    const workspaceDir = join(channelDir, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
      join(channelDir, "settings.json"),
      JSON.stringify({ prompts: { attachedInstructionFiles: ["LOCAL.md"] } }, null, 2),
      "utf8",
    );
    writeFileSync(join(workspaceDir, "SOUL.md"), "workspace soul\n", "utf8");
    writeFileSync(join(workspaceDir, "LOCAL.md"), "workspace local\n", "utf8");

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "model-a",
      basePath: "athena",
    });

    const agent = service.getOrCreateAgent("discord", "channel-1", createBotMock());
    const loader = new DefaultSessionResourceLoader({
      channelDir: join(tempDir, "athena", "discord-channel-1"),
      settingsManager: agent.getSettingsManager(),
      logger: createLoggerMock(),
    });

    loader.reload();
    const prompt = loader.buildSystemPrompt();
    expect(prompt).toContain("## Project Context");
    expect(prompt).toContain("### LOCAL.md");
    expect(prompt).toContain("workspace local");
    expect(prompt).not.toContain("workspace soul");
    expect(prompt).not.toContain("<system-reminder");
  });

  it("allows promptResourceFilenames override to take precedence over settings", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-settings-resource-override-"));
    tempDirs.push(tempDir);

    const globalRoot = join(tempDir, "athena");
    const channelDir = join(globalRoot, "discord-channel-1");
    const workspaceDir = join(channelDir, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
      join(channelDir, "settings.json"),
      JSON.stringify({ prompts: { attachedInstructionFiles: ["LOCAL.md"] } }, null, 2),
      "utf8",
    );
    writeFileSync(join(workspaceDir, "LOCAL.md"), "workspace local\n", "utf8");
    writeFileSync(join(workspaceDir, "OVERRIDE.md"), "workspace override\n", "utf8");

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "model-a",
      basePath: "athena",
    });

    const agent = service.getOrCreateAgent("discord", "channel-1", createBotMock());
    const loader = new DefaultSessionResourceLoader({
      channelDir: join(tempDir, "athena", "discord-channel-1"),
      settingsManager: agent.getSettingsManager(),
      logger: createLoggerMock(),
      promptResourceFilenames: ["OVERRIDE.md"],
    });

    loader.reload();
    const prompt = loader.buildSystemPrompt();
    expect(prompt).toContain("## Project Context");
    expect(prompt).toContain("### OVERRIDE.md");
    expect(prompt).toContain("workspace override");
    expect(prompt).not.toContain("workspace local");
    expect(prompt).not.toContain("<system-reminder");
  });

  it("loads configured attached instruction files in deterministic order", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-settings-attached-files-"));
    tempDirs.push(tempDir);

    const globalRoot = join(tempDir, "athena");
    const channelDir = join(globalRoot, "discord-channel-1");
    const workspaceDir = join(channelDir, "workspace");
    mkdirSync(workspaceDir, { recursive: true });

    writeFileSync(
      join(channelDir, "settings.json"),
      JSON.stringify(
        {
          prompts: {
            attachedInstructionFiles: ["PERSONA.md", "SOUL.md", "EXTRA.md"],
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(join(workspaceDir, "SOUL.md"), "workspace soul\n", "utf8");
    writeFileSync(join(workspaceDir, "PERSONA.md"), "workspace persona\n", "utf8");
    writeFileSync(join(workspaceDir, "EXTRA.md"), "workspace extra\n", "utf8");
    writeFileSync(join(workspaceDir, "AGENTS.md"), "workspace agents\n", "utf8");

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "model-a",
      basePath: "athena",
    });
    const agent = service.getOrCreateAgent("discord", "channel-1", createBotMock());
    const loader = new DefaultSessionResourceLoader({
      channelDir,
      settingsManager: agent.getSettingsManager(),
      logger: createLoggerMock(),
    });
    loader.reload();
    const prompt = loader.buildSystemPrompt();

    const personaIdx = prompt.indexOf("workspace persona");
    const soulIdx = prompt.indexOf("workspace soul");
    const extraIdx = prompt.indexOf("workspace extra");

    expect(personaIdx).toBeGreaterThanOrEqual(0);
    expect(soulIdx).toBeGreaterThan(personaIdx);
    expect(extraIdx).toBeGreaterThan(soulIdx);
    expect(prompt).not.toContain("workspace agents");
    expect(prompt).not.toContain("<system-reminder");
  });

  it("supports overriding built-in instructions and loaded resources", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-settings-loader-overrides-"));
    tempDirs.push(tempDir);

    const service = new AgentSessionService(createContextMock(tempDir), {
      model: "model-a",
      basePath: "athena",
    });
    const channelDir = join(tempDir, "athena", "discord-channel-1");
    const workspaceDir = join(channelDir, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(join(workspaceDir, "SOUL.md"), "workspace soul\n", "utf8");

    const agent = service.getOrCreateAgent("discord", "channel-1", createBotMock());
    const loader = new DefaultSessionResourceLoader({
      channelDir,
      settingsManager: agent.getSettingsManager(),
      logger: createLoggerMock(),
      builtInInstructionsOverride: () => "override persona",
      promptResourceTransform: (resource) =>
        resource.source === "SOUL.md"
          ? {
              ...resource,
              source: "SOUL.override.md",
              content: `${resource.content}\nvia-transform`,
            }
          : resource,
      promptResourcesOverride: (resources) => [
        ...resources,
        {
          source: "MANUAL.md",
          path: "<manual>",
          content: "manual reminder",
        },
      ],
    });
    loader.reload();
    const prompt = loader.buildSystemPrompt();

    expect(prompt).toContain("override persona");
    expect(prompt).not.toContain("workspace agents");
    expect(prompt).not.toContain("<system-reminder");
    expect(prompt).toContain("### SOUL.override.md");
    expect(prompt).toContain("### MANUAL.md");
    expect(prompt).toContain("via-transform");
    expect(prompt).toContain("manual reminder");
  });

  it("bootstraps an existing workspace channel before the first user message without speaking", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-pre-message-bootstrap-"));
    tempDirs.push(tempDir);
    createExistingWorkspace(tempDir);

    const sessionDir = join(tempDir, "athena", "discord-channel-1", "session");
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
