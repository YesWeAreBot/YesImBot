/**
 * Compactor — encapsulates the core compaction execution flow.
 *
 * Extracted from AgentSession to allow independent testing.
 * Handles:
 *   1. prepareCompaction()
 *   2. beforeCompact hook
 *   3. Generate or consume extension-provided compaction
 *   4. sessionManager.appendCompaction(...)
 *   5. Update agent state messages
 *   6. Emit session:compact lifecycle event
 */

import type { LanguageModel } from "ai";

import type { AgentMessage } from "../agent/types.js";
import {
  compact,
  type CompactionPreparation,
  type CompactionPrompts,
  type CompactionResult,
  type CompactionSettings,
  DEFAULT_COMPACTION_PROMPTS,
  prepareCompaction,
} from "./compaction/index.js";
import type { HookRunner } from "./hook-runner.js";
import type { CompactionEntry, SessionManager } from "./session-manager.js";

export interface CompactorOptions {
  sessionManager: SessionManager;
  hookRunner: HookRunner;
  compactionSettings: CompactionSettings;
  compactionPrompts?: CompactionPrompts;
}

export interface CompactorExecuteOptions {
  model: LanguageModel;
  signal: AbortSignal;
  customInstructions?: string;
}

export interface CompactorExecuteResult {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
  fromExtension: boolean;
}

/**
 * Compactor executes the core compaction logic.
 * Callers (AgentSession) handle triggering conditions, retry/abort, and UI events.
 */
export class Compactor {
  private _sessionManager: SessionManager;
  private _hookRunner: HookRunner;
  private _compactionSettings: CompactionSettings;
  private _compactionPrompts: CompactionPrompts;

  constructor(options: CompactorOptions) {
    this._sessionManager = options.sessionManager;
    this._hookRunner = options.hookRunner;
    this._compactionSettings = options.compactionSettings;
    this._compactionPrompts = {
      ...DEFAULT_COMPACTION_PROMPTS,
      ...(options.compactionPrompts ?? {}),
    };
  }

  updateSettings(settings: Partial<CompactionSettings>): void {
    this._compactionSettings = { ...this._compactionSettings, ...settings };
  }

  /**
   * Execute compaction: prepare → hook → generate → persist → return result.
   * Does NOT handle triggering conditions, abort signals for the caller, or UI events.
   *
   * @returns CompactorExecuteResult, or undefined if nothing to compact.
   * @throws Error on cancellation or failure.
   */
  async execute(options: CompactorExecuteOptions): Promise<CompactorExecuteResult | undefined> {
    const pathEntries = this._sessionManager.getBranch();
    const preparation = prepareCompaction(pathEntries, this._compactionSettings);

    if (!preparation) {
      return undefined;
    }

    let extensionCompaction: CompactionResult | undefined;
    let fromExtension = false;

    // beforeCompact hook
    if (this._hookRunner.hasHandlers("session:before-compact")) {
      const result = await this._hookRunner.beforeCompact({
        preparation,
        branchEntries: pathEntries,
        customInstructions: options.customInstructions,
        signal: options.signal,
      });

      if (result?.cancel) {
        throw new Error("Compaction cancelled");
      }

      if (result?.compaction) {
        extensionCompaction = result.compaction;
        fromExtension = true;
      }
    }

    if (options.signal.aborted) {
      throw new Error("Compaction cancelled");
    }

    let summary: string;
    let firstKeptEntryId: string;
    let tokensBefore: number;
    let details: unknown;

    if (extensionCompaction) {
      summary = extensionCompaction.summary;
      firstKeptEntryId = extensionCompaction.firstKeptEntryId;
      tokensBefore = extensionCompaction.tokensBefore;
      details = extensionCompaction.details;
    } else {
      const result = await compact(
        preparation,
        options.model,
        {},
        options.customInstructions,
        options.signal,
        this._compactionPrompts,
      );
      summary = result.summary;
      firstKeptEntryId = result.firstKeptEntryId;
      tokensBefore = result.tokensBefore;
      details = result.details;
    }

    if (options.signal.aborted) {
      throw new Error("Compaction cancelled");
    }

    // Persist
    this._sessionManager.appendCompaction(
      summary,
      firstKeptEntryId,
      tokensBefore,
      details,
      fromExtension,
    );

    return { summary, firstKeptEntryId, tokensBefore, details, fromExtension };
  }

  /**
   * After execute(), update agent messages and emit session:compact event.
   * Separated so callers can control when agent state is updated.
   */
  async postCompaction(
    summary: string,
    fromExtension: boolean,
  ): Promise<{ agentMessages: AgentMessage[]; compactionEntry: CompactionEntry | undefined }> {
    const sessionContext = this._sessionManager.buildSessionContext();
    const newEntries = this._sessionManager.getEntries();
    const savedCompactionEntry = newEntries.find(
      (e) => e.type === "compaction" && e.summary === summary,
    ) as CompactionEntry | undefined;

    if (savedCompactionEntry) {
      await this._hookRunner.emitLifecycle({
        type: "session:compact",
        compactionEntry: savedCompactionEntry,
        fromExtension,
      });
    }

    return {
      agentMessages: sessionContext.messages,
      compactionEntry: savedCompactionEntry,
    };
  }
}
