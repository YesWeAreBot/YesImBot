import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSession } from "../../src/services/session/agent-session";
import { estimateContextTokens } from "../../src/services/session/compaction/estimate";
import { materializeTimeline } from "../../src/services/session/materialize";
import { buildGenerateInputForTest, ChannelRuntime } from "../../src/services/session/runtime";
import { SessionManager } from "../../src/services/session/session-manager";
import type { AthenaSessionSettings } from "../../src/services/session/settings-manager";
import type { ChannelEvent } from "../../src/services/session/types";
import { createTestSettingsManager } from "./test-settings-manager";

type GenerateInput = {
  messages: unknown[];
  abortSignal?: AbortSignal;
};

const generateMock = vi.fn<(input: GenerateInput) => Promise<void>>();
const toolLoopAgentCtorMock = vi.fn();

const { shouldCompactMock, prepareCompactionMock, compactMock } = vi.hoisted(() => ({
  shouldCompactMock: vi.fn(),
  prepareCompactionMock: vi.fn(),
  compactMock: vi.fn(),
}));

vi.mock("ai", () => {
  class ToolLoopAgent {
    readonly options: Record<string, unknown>;
    readonly tools: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.tools = (options.tools as Record<string, unknown>) ?? {};
      toolLoopAgentCtorMock(options);
    }

    async generate(input: GenerateInput): Promise<void> {
      return generateMock(input);
    }
  }

  return {
    ToolLoopAgent,
    stepCountIs: (n: number) => n,
  };
});

vi.mock("../../src/services/session/compaction", () => {
  return {
    DEFAULT_COMPACTION_SETTINGS: {
      enabled: true,
      reserveTokens: 16384,
      keepRecentTokens: 20000,
    },
    shouldCompact: shouldCompactMock,
    prepareCompaction: prepareCompactionMock,
    compact: compactMock,
  };
});

function createLoggerMock() {
  const methods = {
    level: 2,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return Object.assign(
    vi.fn(() => methods),
    methods,
  );
}

function latestModelResolveCall(ctx: ReturnType<typeof createContextMock>): string | undefined {
  const calls = ctx["yesimbot.model"].resolve.mock.calls;
  const lastCall = calls[calls.length - 1];
  const firstArg = lastCall?.[0];
  return typeof firstArg === "string" ? firstArg : undefined;
}

function createContextMock() {
  const logger = createLoggerMock();
  return {
    logger,
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
        model: { provider: "test", modelId: fullId },
      })),
      resolve: vi.fn((modelId: string) => ({ provider: "test", modelId })),
    },
  };
}

function createBotMock(selfId = "bot-self") {
  return {
    selfId,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function createEvent(overrides: Partial<ChannelEvent> = {}): ChannelEvent {
  return {
    platform: "discord",
    channelId: "channel-1",
    userId: "user-1",
    username: "alice",
    content: "@bot hello",
    isDirect: true,
    atSelf: false,
    isReplyToBot: false,
    messageId: `msg-${Math.random().toString(16).slice(2)}`,
    timestamp: Date.now(),
    elements: [],
    ...overrides,
  };
}

function setupGenerateToFinish(inputTokens: number) {
  generateMock.mockImplementationOnce(async () => {
    const options = toolLoopAgentCtorMock.mock.calls[0]?.[0] as
      | { onFinish?: (event: { totalUsage?: { inputTokens?: number } }) => void }
      | undefined;
    options?.onFinish?.({ totalUsage: { inputTokens } });
  });
}

function setupGenerateToFinishWithoutUsage() {
  generateMock.mockImplementationOnce(async () => {
    const options = toolLoopAgentCtorMock.mock.calls[0]?.[0] as
      | { onFinish?: (event: Record<string, never>) => void }
      | undefined;
    options?.onFinish?.({});
  });
}

function createAgent(
  overrides: {
    compactionEnabled?: boolean;
    compactionModel?: string;
    contextWindow?: number;
    compactionReserveTokens?: number;
    compactionKeepRecentTokens?: number;
    sessionManager?: SessionManager;
  } = {},
) {
  const ctx = createContextMock();
  const bot = createBotMock();
  const sessionManager = overrides.sessionManager ?? SessionManager.inMemory("discord:channel-1");

  if (!overrides.sessionManager) {
    sessionManager.appendCustomMessageEntry("channel_message", "[alice]: hello", false, {
      userId: "user-1",
    });
  }

  const agent = new ChannelRuntime(ctx as never, {
    bot: bot as never,
    sessionManager,
    settingsManager: createTestSettingsManager({
      compaction: {
        contextWindow: overrides.contextWindow ?? 100000,
        reserveTokens: overrides.compactionReserveTokens ?? 16384,
        keepRecentTokens: overrides.compactionKeepRecentTokens ?? 20000,
        enabled: overrides.compactionEnabled,
        model: overrides.compactionModel,
      },
    } satisfies AthenaSessionSettings),
    platform: "discord",
    channelId: "channel-1",
    basePath: "/tmp/athena-test",
  });

  return { agent, sessionManager, ctx };
}

describe("ChannelRuntime compaction integration", () => {
  beforeEach(() => {
    generateMock.mockReset();
    toolLoopAgentCtorMock.mockClear();
    shouldCompactMock.mockReset();
    prepareCompactionMock.mockReset();
    compactMock.mockReset();

    shouldCompactMock.mockImplementation(
      (contextTokens: number, contextWindow: number, settings) => {
        return settings.enabled && contextTokens > contextWindow - settings.reserveTokens;
      },
    );
  });

  it("triggers compaction when totalUsage.inputTokens exceeds threshold", async () => {
    const { agent, sessionManager } = createAgent();
    const appendCompactionSpy = vi.spyOn(sessionManager, "appendCompaction");

    prepareCompactionMock.mockReturnValue({
      firstKeptEntryId: "keep-1",
      messagesToSummarize: [],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 90000,
      settings: {
        enabled: true,
        reserveTokens: 16384,
        keepRecentTokens: 20000,
      },
    });
    compactMock.mockResolvedValue({
      summary: "summary text",
      firstKeptEntryId: "keep-1",
      tokensBefore: 90000,
    });

    setupGenerateToFinish(90000);
    await agent.receive(createEvent({ messageId: "msg-trigger" }));

    await vi.waitFor(() => {
      expect(appendCompactionSpy).toHaveBeenCalledWith("summary text", "keep-1", 90000);
    });
    expect(prepareCompactionMock.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "channel_message" })]),
    );
    expect(prepareCompactionMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      undefined,
      90000,
    );
  });

  it("does not trigger compaction when below threshold", async () => {
    const { agent, sessionManager } = createAgent();
    const appendCompactionSpy = vi.spyOn(sessionManager, "appendCompaction");

    setupGenerateToFinish(10000);
    await agent.receive(createEvent({ messageId: "msg-no-trigger" }));

    await vi.waitFor(() => {
      expect(agent.getResponseState()).toBe("idle");
    });
    expect(appendCompactionSpy).not.toHaveBeenCalled();
  });

  it("does not trigger compaction when compactionEnabled is false", async () => {
    const { agent, sessionManager } = createAgent({ compactionEnabled: false });
    const appendCompactionSpy = vi.spyOn(sessionManager, "appendCompaction");

    setupGenerateToFinish(90000);
    await agent.receive(createEvent({ messageId: "msg-disabled" }));

    await vi.waitFor(() => {
      expect(agent.getResponseState()).toBe("idle");
    });
    expect(appendCompactionSpy).not.toHaveBeenCalled();
  });

  it("catches compaction errors without crashing", async () => {
    const { agent, ctx } = createAgent();

    prepareCompactionMock.mockReturnValue({
      firstKeptEntryId: "keep-1",
      messagesToSummarize: [],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 90000,
      settings: {
        enabled: true,
        reserveTokens: 16384,
        keepRecentTokens: 20000,
      },
    });
    compactMock.mockRejectedValue(new Error("compaction exploded"));

    setupGenerateToFinish(90000);
    await agent.receive(createEvent({ messageId: "msg-error" }));

    await vi.waitFor(() => {
      expect(agent.getResponseState()).toBe("idle");
    });
    await vi.waitFor(() => {
      expect(ctx.logger.error).toHaveBeenCalled();
    });
  });

  it("falls back to session token estimation when finish usage is missing", async () => {
    const { agent, sessionManager } = createAgent({
      contextWindow: 100,
      compactionReserveTokens: 10,
      compactionKeepRecentTokens: 20,
    });
    const appendCompactionSpy = vi.spyOn(sessionManager, "appendCompaction");

    sessionManager.appendCustomMessageEntry("channel_message", "x".repeat(600), false, {
      userId: "user-2",
    });

    prepareCompactionMock.mockReturnValue({
      firstKeptEntryId: "keep-1",
      messagesToSummarize: [],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 900,
      settings: {
        enabled: true,
        reserveTokens: 10,
        keepRecentTokens: 20,
      },
    });
    compactMock.mockResolvedValue({
      summary: "summary text",
      firstKeptEntryId: "keep-1",
      tokensBefore: 900,
    });

    setupGenerateToFinishWithoutUsage();
    await agent.receive(createEvent({ messageId: "msg-missing-usage" }));

    await vi.waitFor(() => {
      expect(appendCompactionSpy).toHaveBeenCalledWith("summary text", "keep-1", 900);
    });

    const compactionRecords = prepareCompactionMock.mock.calls[0]?.[0];
    const contextTokens = prepareCompactionMock.mock.calls[0]?.[3];
    expect(contextTokens).toBe(estimateContextTokens(materializeTimeline(compactionRecords)));
    expect(contextTokens).toBeGreaterThan(90);
  });

  it("falls back to main model when compactionModel is not set", async () => {
    const { agent, ctx } = createAgent();

    prepareCompactionMock.mockReturnValue({
      firstKeptEntryId: "keep-1",
      messagesToSummarize: [],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 90000,
      settings: {
        enabled: true,
        reserveTokens: 16384,
        keepRecentTokens: 20000,
      },
    });
    compactMock.mockResolvedValue({
      summary: "summary text",
      firstKeptEntryId: "keep-1",
      tokensBefore: 90000,
    });

    setupGenerateToFinish(90000);
    await agent.receive(createEvent({ messageId: "msg-fallback" }));

    await vi.waitFor(() => {
      expect(latestModelResolveCall(ctx)).toBe("test:model");
    });
  });

  it("uses compactionModel when set", async () => {
    const { agent, ctx } = createAgent({ compactionModel: "test:small-model" });

    prepareCompactionMock.mockReturnValue({
      firstKeptEntryId: "keep-1",
      messagesToSummarize: [],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 90000,
      settings: {
        enabled: true,
        reserveTokens: 16384,
        keepRecentTokens: 20000,
      },
    });
    compactMock.mockResolvedValue({
      summary: "summary text",
      firstKeptEntryId: "keep-1",
      tokensBefore: 90000,
    });

    setupGenerateToFinish(90000);
    await agent.receive(createEvent({ messageId: "msg-model" }));

    await vi.waitFor(() => {
      expect(latestModelResolveCall(ctx)).toBe("test:small-model");
    });
  });

  it("builds next response context from compaction summary and kept messages", async () => {
    const { agent, sessionManager } = createAgent();
    sessionManager.appendCustomMessageEntry(
      "channel_message",
      "legacy context that should compact",
      false,
      {
        userId: "user-legacy",
      },
    );

    let firstKeptEntryId = "keep-1";
    prepareCompactionMock.mockImplementation((records: Array<{ id: string }>) => {
      firstKeptEntryId = records[records.length - 1]?.id ?? "keep-1";
      return {
        firstKeptEntryId,
        messagesToSummarize: [],
        turnPrefixMessages: [],
        isSplitTurn: false,
        tokensBefore: 90000,
        settings: {
          enabled: true,
          reserveTokens: 16384,
          keepRecentTokens: 20000,
        },
      };
    });
    compactMock.mockImplementation(async () => ({
      summary: "summary text",
      firstKeptEntryId,
      tokensBefore: 90000,
    }));

    setupGenerateToFinish(90000);
    await agent.receive(createEvent({ messageId: "msg-context" }));

    await vi.waitFor(() => {
      expect(sessionManager.getEntries().some((entry) => entry.type === "compaction")).toBe(true);
    });

    const session = new AgentSession(sessionManager);
    expect(session.getModelMessages()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: expect.stringContaining("summary text") }),
      ]),
    );

    const nextInput = buildGenerateInputForTest({
      instructions: "next run",
      session,
    });

    expect(nextInput.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: expect.stringContaining("summary text") }),
      ]),
    );
    expect(nextInput.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("legacy context that should compact"),
        }),
      ]),
    );
  });

  it("allows another compaction after new timeline records arrive", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    sessionManager.appendCustomMessageEntry("channel_message", "[alice]: first", false, {
      userId: "user-1",
    });
    const keptEntryId = sessionManager.appendCustomMessageEntry(
      "channel_message",
      "[alice]: keep this window",
      false,
      {
        userId: "user-2",
      },
    );
    sessionManager.appendCompaction("previous summary", keptEntryId, 50000);
    const newestEntryId = sessionManager.appendCustomMessageEntry(
      "channel_message",
      "[alice]: new growth after compaction",
      false,
      {
        userId: "user-3",
      },
    );

    const { agent } = createAgent({ sessionManager });

    prepareCompactionMock.mockImplementation(
      (records, _settings, previousSummary, contextTokens) => {
        expect(records.map((record: { id: string }) => record.id)).toEqual([
          keptEntryId,
          newestEntryId,
        ]);
        expect(previousSummary).toBe("previous summary");
        expect(contextTokens).toBe(75000);
        return {
          firstKeptEntryId: newestEntryId,
          recordsToSummarize: [],
          turnPrefixRecords: [],
          isSplitTurn: false,
          tokensBefore: 75000,
          previousSummary,
          settings: {
            enabled: true,
            reserveTokens: 16384,
            keepRecentTokens: 20000,
          },
        };
      },
    );
    compactMock.mockResolvedValue({
      summary: "updated summary",
      firstKeptEntryId: newestEntryId,
      tokensBefore: 75000,
    });

    const result = await agent.runCompaction(75000);

    expect(result).toEqual({
      compacted: true,
      firstKeptEntryId: newestEntryId,
      summaryLength: "updated summary".length,
      tokensBefore: 75000,
    });
    expect(sessionManager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(
      2,
    );
  });

  it("skips manual compaction when the latest entry is already a compaction", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const keptEntryId = sessionManager.appendCustomMessageEntry(
      "channel_message",
      "[alice]: keep this window",
      false,
      {
        userId: "user-1",
      },
    );
    sessionManager.appendCompaction("previous summary", keptEntryId, 50000);

    const { agent } = createAgent({ sessionManager });

    const result = await agent.runCompaction(75000);

    expect(result).toEqual({ compacted: false, reason: "already-compacted" });
    expect(prepareCompactionMock).not.toHaveBeenCalled();
    expect(compactMock).not.toHaveBeenCalled();
  });
});
