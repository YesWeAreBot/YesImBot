import type { LanguageModel } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentMessage } from "../../src/agent/types.js";
import type {
  CompactionPreparation,
  CompactionResult,
} from "../../src/session/compaction/index.js";
import { compact, prepareCompaction } from "../../src/session/compaction/index.js";
import { Compactor, type CompactorOptions } from "../../src/session/compactor.js";
import type { BeforeCompactResult, HookRunner } from "../../src/session/hook-runner.js";
import type {
  CompactionEntry,
  SessionContext,
  SessionEntry,
  SessionManager,
} from "../../src/session/session-manager.js";

// ============================================================================
// Mocks
// ============================================================================

vi.mock("../../src/session/compaction/index.js", () => ({
  prepareCompaction: vi.fn<() => CompactionPreparation | undefined>(),
  compact: vi.fn<() => Promise<CompactionResult>>(),
  DEFAULT_COMPACTION_PROMPTS: {},
}));

// ============================================================================
// Helpers
// ============================================================================

let idCounter = 0;
function nextId(): string {
  return (++idCounter).toString(16).padStart(8, "0");
}

function resetIds(): void {
  idCounter = 0;
}

function makeEntry(overrides?: Partial<SessionEntry>): SessionEntry {
  const id = nextId();
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: Date.now(),
    } as AgentMessage,
    ...overrides,
  } as SessionEntry;
}

const MOCK_PREPARATION: CompactionPreparation = {
  messagesToSummarize: [
    {
      role: "user",
      content: [{ type: "text", text: "old message" }],
      timestamp: Date.now(),
    } as AgentMessage,
  ],
  tokensBefore: 5000,
  previousSummary: undefined,
  isSplitTurn: false,
  turnPrefixMessages: [],
  firstKeptEntryId: "kept-001",
};

const MOCK_COMPACTION_RESULT: CompactionResult = {
  summary: "Session summary of old messages",
  firstKeptEntryId: "kept-001",
  tokensBefore: 5000,
  details: { source: "llm" },
};

const MOCK_SESSION_CONTEXT: SessionContext = {
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: "recent message" }],
      timestamp: Date.now(),
    } as AgentMessage,
  ],
  header: {
    type: "session",
    id: "test-session",
    timestamp: new Date().toISOString(),
  },
} as unknown as SessionContext;

function createMockSessionManager(overrides?: {
  branch?: SessionEntry[];
  entries?: SessionEntry[];
  sessionContext?: SessionContext;
}): SessionManager {
  const branch = overrides?.branch ?? [makeEntry(), makeEntry()];
  const entries = overrides?.entries ?? [...branch];
  const sessionContext = overrides?.sessionContext ?? MOCK_SESSION_CONTEXT;

  return {
    getBranch: vi.fn<() => SessionEntry[]>().mockReturnValue(branch),
    appendCompaction: vi.fn<() => string>(),
    buildSessionContext: vi.fn<() => SessionContext>().mockReturnValue(sessionContext),
    getEntries: vi.fn<() => SessionEntry[]>().mockReturnValue(entries),
  } as unknown as SessionManager;
}

function createMockHookRunner(overrides?: {
  hasBeforeCompactHandlers?: boolean;
  beforeCompactResult?: BeforeCompactResult;
}): HookRunner {
  const hasHandlers = overrides?.hasBeforeCompactHandlers ?? false;
  const beforeCompactResult = overrides?.beforeCompactResult;

  return {
    hasHandlers: vi.fn<(event: string) => boolean>().mockImplementation((event: string) => {
      if (event === "session:before-compact") return hasHandlers;
      return false;
    }),
    beforeCompact: vi
      .fn<() => Promise<BeforeCompactResult | undefined>>()
      .mockResolvedValue(beforeCompactResult ?? undefined),
    emitLifecycle: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  } as unknown as HookRunner;
}

function createMockModel(): LanguageModel {
  return {} as LanguageModel;
}

function createAbortController(): AbortController {
  return new AbortController();
}

function createCompactor(overrides?: {
  sessionManager?: SessionManager;
  hookRunner?: HookRunner;
  compactionSettings?: Partial<CompactorOptions["compactionSettings"]>;
}): {
  compactor: Compactor;
  sessionManager: SessionManager;
  hookRunner: HookRunner;
} {
  const sessionManager = overrides?.sessionManager ?? createMockSessionManager();
  const hookRunner = overrides?.hookRunner ?? createMockHookRunner();

  const compactor = new Compactor({
    sessionManager,
    hookRunner,
    compactionSettings: {
      enabled: true,
      reserveTokens: 4096,
      keepRecentTokens: 2000,
      ...(overrides?.compactionSettings ?? {}),
    },
  });

  return { compactor, sessionManager, hookRunner };
}

// ============================================================================
// Tests
// ============================================================================

describe("Compactor", () => {
  beforeEach(() => {
    resetIds();
    vi.clearAllMocks();
    // Default: prepareCompaction returns a valid preparation
    vi.mocked(prepareCompaction).mockReturnValue(MOCK_PREPARATION);
    vi.mocked(compact).mockResolvedValue(MOCK_COMPACTION_RESULT);
  });

  // ==========================================================================
  // execute() — normal compaction flow
  // ==========================================================================

  describe("execute", () => {
    it("runs the full flow: prepare → compact → persist", async () => {
      const { compactor, sessionManager } = createCompactor();
      const model = createMockModel();
      const controller = createAbortController();

      const result = await compactor.execute({ model, signal: controller.signal });

      expect(result).toBeDefined();
      expect(result!.summary).toBe(MOCK_COMPACTION_RESULT.summary);
      expect(result!.firstKeptEntryId).toBe(MOCK_COMPACTION_RESULT.firstKeptEntryId);
      expect(result!.tokensBefore).toBe(MOCK_COMPACTION_RESULT.tokensBefore);
      expect(result!.fromExtension).toBe(false);

      // Verify flow calls
      expect(sessionManager.getBranch).toHaveBeenCalledOnce();
      expect(prepareCompaction).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ enabled: true }),
      );
      expect(compact).toHaveBeenCalledWith(
        MOCK_PREPARATION,
        model,
        {},
        undefined, // customInstructions
        controller.signal,
        expect.any(Object), // compactionPrompts
      );
      expect(sessionManager.appendCompaction).toHaveBeenCalledWith(
        MOCK_COMPACTION_RESULT.summary,
        MOCK_COMPACTION_RESULT.firstKeptEntryId,
        MOCK_COMPACTION_RESULT.tokensBefore,
        MOCK_COMPACTION_RESULT.details,
        false, // fromExtension
      );
    });

    it("returns undefined when prepareCompaction returns undefined (nothing to compact)", async () => {
      vi.mocked(prepareCompaction).mockReturnValue(undefined);
      const { compactor } = createCompactor();

      const result = await compactor.execute({
        model: createMockModel(),
        signal: createAbortController().signal,
      });

      expect(result).toBeUndefined();
    });

    it("passes customInstructions to compact()", async () => {
      const { compactor } = createCompactor();
      const customInstructions = "Focus on technical details";

      await compactor.execute({
        model: createMockModel(),
        signal: createAbortController().signal,
        customInstructions,
      });

      expect(compact).toHaveBeenCalledWith(
        MOCK_PREPARATION,
        expect.anything(),
        {},
        customInstructions,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  // ==========================================================================
  // execute() — extension-provided compaction
  // ==========================================================================

  describe("extension-provided compaction", () => {
    it("uses extension compaction result and skips LLM compact()", async () => {
      const extensionResult: CompactionResult = {
        summary: "Extension-generated summary",
        firstKeptEntryId: "ext-kept-001",
        tokensBefore: 3000,
        details: { source: "extension", artifacts: 5 },
      };

      const hookRunner = createMockHookRunner({
        hasBeforeCompactHandlers: true,
        beforeCompactResult: { compaction: extensionResult },
      });

      const { compactor, sessionManager } = createCompactor({ hookRunner });

      const result = await compactor.execute({
        model: createMockModel(),
        signal: createAbortController().signal,
      });

      expect(result).toBeDefined();
      expect(result!.summary).toBe("Extension-generated summary");
      expect(result!.firstKeptEntryId).toBe("ext-kept-001");
      expect(result!.tokensBefore).toBe(3000);
      expect(result!.fromExtension).toBe(true);

      // LLM compact() should NOT have been called
      expect(compact).not.toHaveBeenCalled();

      // Should persist with fromExtension=true
      expect(sessionManager.appendCompaction).toHaveBeenCalledWith(
        "Extension-generated summary",
        "ext-kept-001",
        3000,
        { source: "extension", artifacts: 5 },
        true, // fromExtension
      );
    });

    it("calls beforeCompact hook when handlers are registered", async () => {
      const hookRunner = createMockHookRunner({ hasBeforeCompactHandlers: true });

      const { compactor } = createCompactor({ hookRunner });

      await compactor.execute({
        model: createMockModel(),
        signal: createAbortController().signal,
        customInstructions: "custom",
      });

      expect(hookRunner.beforeCompact).toHaveBeenCalledWith({
        preparation: MOCK_PREPARATION,
        branchEntries: expect.any(Array),
        customInstructions: "custom",
        signal: expect.any(AbortSignal),
      });
    });

    it("skips beforeCompact hook when no handlers are registered", async () => {
      const hookRunner = createMockHookRunner({ hasBeforeCompactHandlers: false });

      const { compactor } = createCompactor({ hookRunner });

      await compactor.execute({
        model: createMockModel(),
        signal: createAbortController().signal,
      });

      expect(hookRunner.beforeCompact).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // execute() — cancellation
  // ==========================================================================

  describe("cancellation", () => {
    it("throws when signal is already aborted before compact()", async () => {
      const hookRunner = createMockHookRunner({ hasBeforeCompactHandlers: false });
      const { compactor } = createCompactor({ hookRunner });

      const controller = createAbortController();
      controller.abort();

      await expect(
        compactor.execute({ model: createMockModel(), signal: controller.signal }),
      ).rejects.toThrow("Compaction cancelled");
    });

    it("throws when signal is aborted between hook and compact()", async () => {
      const hookRunner = createMockHookRunner({ hasBeforeCompactHandlers: true });
      // Hook returns nothing (no cancel, no compaction) — falls through to compact
      vi.mocked(hookRunner.beforeCompact).mockResolvedValue(undefined);

      const { compactor } = createCompactor({ hookRunner });

      const controller = createAbortController();

      // Abort the signal after hook but before compact would run
      vi.mocked(hookRunner.beforeCompact).mockImplementation(async () => {
        controller.abort();
        return undefined;
      });

      await expect(
        compactor.execute({ model: createMockModel(), signal: controller.signal }),
      ).rejects.toThrow("Compaction cancelled");
    });

    it("throws when signal is aborted after compact() but before persist", async () => {
      const hookRunner = createMockHookRunner({ hasBeforeCompactHandlers: false });
      const { compactor } = createCompactor({ hookRunner });

      const controller = createAbortController();

      vi.mocked(compact).mockImplementation(async () => {
        controller.abort();
        return MOCK_COMPACTION_RESULT;
      });

      await expect(
        compactor.execute({ model: createMockModel(), signal: controller.signal }),
      ).rejects.toThrow("Compaction cancelled");
    });
  });

  // ==========================================================================
  // execute() — beforeCompact hook cancel
  // ==========================================================================

  describe("beforeCompact hook cancel", () => {
    it("throws 'Compaction cancelled' when hook returns { cancel: true }", async () => {
      const hookRunner = createMockHookRunner({
        hasBeforeCompactHandlers: true,
        beforeCompactResult: { cancel: true },
      });

      const { compactor, sessionManager } = createCompactor({ hookRunner });

      await expect(
        compactor.execute({ model: createMockModel(), signal: createAbortController().signal }),
      ).rejects.toThrow("Compaction cancelled");

      // Should NOT have called compact() or appendCompaction
      expect(compact).not.toHaveBeenCalled();
      expect(sessionManager.appendCompaction).not.toHaveBeenCalled();
    });

    it("still calls LLM compact when hook returns empty result (no cancel, no compaction)", async () => {
      const hookRunner = createMockHookRunner({
        hasBeforeCompactHandlers: true,
        beforeCompactResult: undefined,
      });

      const { compactor } = createCompactor({ hookRunner });

      const result = await compactor.execute({
        model: createMockModel(),
        signal: createAbortController().signal,
      });

      expect(result).toBeDefined();
      expect(compact).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // postCompaction()
  // ==========================================================================

  describe("postCompaction", () => {
    it("returns agent messages from session context", async () => {
      const compactionEntry: CompactionEntry = {
        type: "compaction",
        id: "compact-001",
        parentId: null,
        timestamp: new Date().toISOString(),
        summary: "test summary",
        firstKeptEntryId: "kept-001",
        tokensBefore: 5000,
      };

      const sessionContext: SessionContext = {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "recent message" }],
            timestamp: Date.now(),
          } as AgentMessage,
        ],
        header: {
          type: "session",
          id: "test-session",
          timestamp: new Date().toISOString(),
        },
      } as unknown as SessionContext;

      const sessionManager = createMockSessionManager({
        sessionContext,
        entries: [makeEntry(), compactionEntry as unknown as SessionEntry],
      });

      const { compactor } = createCompactor({ sessionManager });

      const result = await compactor.postCompaction("test summary", false);

      expect(result.agentMessages).toEqual(sessionContext.messages);
      expect(sessionManager.buildSessionContext).toHaveBeenCalledOnce();
    });

    it("finds and returns the matching compaction entry", async () => {
      const compactionEntry: CompactionEntry = {
        type: "compaction",
        id: "compact-002",
        parentId: null,
        timestamp: new Date().toISOString(),
        summary: "the summary we want",
        firstKeptEntryId: "kept-002",
        tokensBefore: 4000,
      };

      const sessionManager = createMockSessionManager({
        entries: [makeEntry(), compactionEntry as unknown as SessionEntry],
      });

      const { compactor } = createCompactor({ sessionManager });

      const result = await compactor.postCompaction("the summary we want", false);

      expect(result.compactionEntry).toEqual(compactionEntry);
    });

    it("returns undefined compactionEntry when summary does not match", async () => {
      const sessionManager = createMockSessionManager({
        entries: [makeEntry()],
      });

      const { compactor } = createCompactor({ sessionManager });

      const result = await compactor.postCompaction("non-existent summary", false);

      expect(result.compactionEntry).toBeUndefined();
    });

    it("emits session:compact lifecycle event when compaction entry is found", async () => {
      const compactionEntry: CompactionEntry = {
        type: "compaction",
        id: "compact-003",
        parentId: null,
        timestamp: new Date().toISOString(),
        summary: "event test summary",
        firstKeptEntryId: "kept-003",
        tokensBefore: 3000,
      };

      const hookRunner = createMockHookRunner();
      const sessionManager = createMockSessionManager({
        entries: [makeEntry(), compactionEntry as unknown as SessionEntry],
      });

      const { compactor } = createCompactor({ hookRunner, sessionManager });

      await compactor.postCompaction("event test summary", true);

      expect(hookRunner.emitLifecycle).toHaveBeenCalledWith({
        type: "session:compact",
        compactionEntry,
        fromExtension: true,
      });
    });

    it("does NOT emit session:compact when no matching compaction entry found", async () => {
      const hookRunner = createMockHookRunner();
      const sessionManager = createMockSessionManager({
        entries: [makeEntry()],
      });

      const { compactor } = createCompactor({ hookRunner, sessionManager });

      await compactor.postCompaction("no match", false);

      expect(hookRunner.emitLifecycle).not.toHaveBeenCalled();
    });

    it("passes fromExtension flag correctly to lifecycle event", async () => {
      const compactionEntry: CompactionEntry = {
        type: "compaction",
        id: "compact-004",
        parentId: null,
        timestamp: new Date().toISOString(),
        summary: "ext summary",
        firstKeptEntryId: "kept-004",
        tokensBefore: 2000,
      };

      const hookRunner = createMockHookRunner();
      const sessionManager = createMockSessionManager({
        entries: [makeEntry(), compactionEntry as unknown as SessionEntry],
      });

      const { compactor } = createCompactor({ hookRunner, sessionManager });

      // fromExtension = true
      await compactor.postCompaction("ext summary", true);
      expect(hookRunner.emitLifecycle).toHaveBeenCalledWith(
        expect.objectContaining({ fromExtension: true }),
      );

      vi.mocked(hookRunner.emitLifecycle).mockClear();

      // fromExtension = false
      await compactor.postCompaction("ext summary", false);
      expect(hookRunner.emitLifecycle).toHaveBeenCalledWith(
        expect.objectContaining({ fromExtension: false }),
      );
    });
  });

  // ==========================================================================
  // updateSettings()
  // ==========================================================================

  describe("updateSettings", () => {
    it("merges new settings with existing ones", async () => {
      const { compactor } = createCompactor({
        compactionSettings: { enabled: true, reserveTokens: 4096, keepRecentTokens: 2000 },
      });

      compactor.updateSettings({ keepRecentTokens: 5000 });

      // Next execute should use the updated settings
      await compactor.execute({
        model: createMockModel(),
        signal: createAbortController().signal,
      });

      expect(prepareCompaction).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          enabled: true,
          reserveTokens: 4096,
          keepRecentTokens: 5000,
        }),
      );
    });

    it("preserves unmodified settings", async () => {
      const { compactor } = createCompactor({
        compactionSettings: { enabled: true, reserveTokens: 8192, keepRecentTokens: 3000 },
      });

      compactor.updateSettings({ reserveTokens: 16384 });

      await compactor.execute({
        model: createMockModel(),
        signal: createAbortController().signal,
      });

      expect(prepareCompaction).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          enabled: true,
          reserveTokens: 16384,
          keepRecentTokens: 3000,
        }),
      );
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe("edge cases", () => {
    it("handles extension hook returning both cancel and compaction (cancel wins)", async () => {
      // The hook-runner implementation returns cancel if cancel is true,
      // regardless of compaction. Let's verify Compactor respects this.
      const hookRunner = createMockHookRunner({
        hasBeforeCompactHandlers: true,
        beforeCompactResult: {
          cancel: true,
          compaction: { summary: "should not matter", firstKeptEntryId: "x", tokensBefore: 0 },
        },
      });

      const { compactor } = createCompactor({ hookRunner });

      await expect(
        compactor.execute({ model: createMockModel(), signal: createAbortController().signal }),
      ).rejects.toThrow("Compaction cancelled");
    });

    it("passes branch entries from sessionManager to beforeCompact hook", async () => {
      const branchEntries = [makeEntry(), makeEntry(), makeEntry()];
      const sessionManager = createMockSessionManager({ branch: branchEntries });
      const hookRunner = createMockHookRunner({ hasBeforeCompactHandlers: true });

      const { compactor } = createCompactor({ hookRunner, sessionManager });

      await compactor.execute({
        model: createMockModel(),
        signal: createAbortController().signal,
      });

      expect(hookRunner.beforeCompact).toHaveBeenCalledWith(
        expect.objectContaining({
          branchEntries,
        }),
      );
    });

    it("does not call appendCompaction when prepareCompaction returns undefined", async () => {
      vi.mocked(prepareCompaction).mockReturnValue(undefined);
      const { compactor, sessionManager } = createCompactor();

      await compactor.execute({
        model: createMockModel(),
        signal: createAbortController().signal,
      });

      expect(sessionManager.appendCompaction).not.toHaveBeenCalled();
    });
  });
});
