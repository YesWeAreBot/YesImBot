import type { SpawnSyncReturns } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { TestContext } from "vitest";

import type { DecisionRecord } from "../../src/agent/decision-record";

/** Limits shared by the journal specs; the child harness receives them verbatim. */
export const journalOptions = { maxEntries: 3, maxBytes: 4096, retentionHours: 24 };

/** Minimal valid record. `extra` carries the junk that sanitization must drop. */
export function record(id: string, extra: Record<string, unknown> = {}): DecisionRecord {
    return {
        version: 1,
        id,
        key: "onebot:channel",
        time: Date.now(),
        stimulusType: "user_message",
        stage: "calculated",
        reason: "probability_roll",
        decision: true,
        ...extra,
    } as DecisionRecord;
}

/** Throwaway directory, removed when the test finishes. */
export async function temporary(t: TestContext): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "decision-journal-"));
    t.onTestFinished(() => fs.rm(dir, { recursive: true, force: true }));
    return dir;
}

/** Degraded conditions reach the operator through the constructor's warning callback. */
export function warnings() {
    const collected: string[] = [];
    return { collected, warn: (message: string) => void collected.push(message) };
}

/** Parse a JSONL log written by the journal or printed by the replay CLI. */
export function parseJsonl(text: string): Array<Record<string, any>> {
    return text.trim()
        ? text
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line))
        : [];
}

/** Spawned tools explain themselves on stderr, so surface it when they fail. */
export function assertCleanExit(result: SpawnSyncReturns<string>) {
    if (result.status !== 0) throw new Error(`process exited with ${result.status}:\n${result.stderr}`);
}
