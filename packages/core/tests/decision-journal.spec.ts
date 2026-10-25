// The journal's guarantees are about real files, real permission bits and real
// processes, so every case runs against a throwaway directory, and the
// cross-process cases spawn tests/helpers/decision-journal-child.cjs.

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DecisionJournal } from "../src/agent/decision-journal";
import { assertCleanExit, journalOptions, parseJsonl, record, temporary, warnings } from "./helpers/decision-fixtures";

// Warnings are the journal's only operator-facing signal: every degraded
// condition arrives as a message string, so these patterns pin the facts an
// operator has to be told. Deliberate rewording fails here.
const locked = /被锁定.*持久化记录与查询不可用/;
const staleLock = /遗留锁.*停止所有实例.*手动清理/;
const releaseFailed = /锁释放失败.*停止所有实例.*手动清理/;

const childHarness = path.resolve(import.meta.dirname, "helpers/decision-journal-child.cjs");

/** Drives the child harness: `list` appends records and reports what it can see, `exit` crashes first. */
function runChild(directory: string, command: "list" | "exit", records: unknown[]) {
    return spawnSync(process.execPath, [childHarness, directory, command, JSON.stringify({ options: journalOptions, records })], {
        encoding: "utf8",
    });
}

describe("persistence", () => {
    it("serializes concurrent appends and reopens with filters intact", async (t) => {
        const dir = await temporary(t);
        const journal = new DecisionJournal(dir, journalOptions);
        t.onTestFinished(() => journal.close());
        const now = Date.now();
        await Promise.all([
            journal.append(record("a", { time: now - 10 })),
            journal.append(record("b", { key: "other", time: now })),
            journal.append(record("c", { time: now + 10 })),
        ]);
        expect((await journal.list({ key: "onebot:channel", from: now, to: now + 20 })).map((entry) => entry.id)).toStrictEqual(["c"]);
        await journal.close();
        const restored = new DecisionJournal(dir, journalOptions);
        t.onTestFinished(() => restored.close());
        expect((await restored.list({ limit: 2 })).map((entry) => entry.id)).toStrictEqual(["b", "c"]);
        await restored.close();
        // A closed journal is inert: appends are dropped instead of throwing.
        await restored.append(record("closed"));
        expect((await restored.list({})).length).toBe(3);
    });

    it("enforces entry, byte and retention caps across reopen", async (t) => {
        const dir = await temporary(t);
        const limits = { ...journalOptions, maxEntries: 2, maxBytes: 400 };
        const journal = new DecisionJournal(dir, limits);
        t.onTestFinished(() => journal.close());
        await journal.append(record("expired", { time: Date.now() - 25 * 3600000 }));
        for (const id of ["a", "b", "c", "d"]) await journal.append(record(id));
        await journal.flush();
        const records = await journal.list({});
        expect(records.length).toBeLessThanOrEqual(2);
        expect(records.at(-1)!.id).toBe("d");
        expect((await fs.stat(path.join(dir, "decisions.jsonl"))).size).toBeLessThanOrEqual(400);
        expect(records.map((entry) => entry.id)).not.toContain("expired");
        await journal.close();
        const recovered = new DecisionJournal(dir, limits);
        t.onTestFinished(() => recovered.close());
        expect(await recovered.list({})).toStrictEqual(records);
    });

    // NTFS reports 0666 and ignores chmod, so permission bits only mean something on POSIX.
    it.runIf(process.platform !== "win32")("keeps the directory, the journal and the lock private", async (t) => {
        const dir = await temporary(t);
        const journal = new DecisionJournal(dir, journalOptions);
        t.onTestFinished(() => journal.close());
        await journal.list({});
        expect((await fs.stat(path.join(dir, ".decisions.lock"))).mode & 0o777).toBe(0o600);
        await journal.append(record("a"));
        await journal.close();
        expect((await fs.stat(path.join(dir, "decisions.jsonl"))).mode & 0o777).toBe(0o600);
        expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
    });

    it("bounds the write backlog, counts dropped records and returns detached snapshots", async (t) => {
        const dir = await temporary(t);
        const log = warnings();
        const journal = new DecisionJournal(dir, { ...journalOptions, maxEntries: 2 }, log.warn);
        t.onTestFinished(() => journal.close());
        await Promise.all(Array.from({ length: 100 }, (_, index) => journal.append(record(`id-${index}`))));
        expect((await journal.list({})).length).toBe(2);
        expect(log.collected).toContainEqual(expect.stringMatching(/queue is full/));
        expect(journal.diagnostics.droppedRecords).toBe(98);
        const snapshot = await journal.list({});
        snapshot[0].key = "mutated";
        expect((await journal.list({}))[0].key).toBe("onebot:channel");
        expect(await journal.list({ limit: 0 })).toStrictEqual([]);
    });
});

describe("sanitization", () => {
    it("persists only allowlisted metadata and discards nested secrets", async (t) => {
        const dir = await temporary(t);
        const journal = new DecisionJournal(dir, journalOptions);
        t.onTestFinished(() => journal.close());
        await journal.append(
            record("safe", {
                content: "SECRET_BODY",
                prompt: "SECRET_PROMPT",
                headers: { authorization: "SECRET_TOKEN" },
                error: "SECRET_ERROR",
                assessment: { reason: "SECRET_ASSESSMENT" },
                target: { content: "SECRET_TARGET" },
            }),
        );
        await journal.append(record("badreason", { reason: "SECRET_REASON" }));
        await journal.append(record("badstage", { stage: "SECRET_STAGE" }));
        await journal.flush();
        const stored = await fs.readFile(path.join(dir, "decisions.jsonl"), "utf8");
        expect(stored).not.toContain("SECRET");
        expect(stored).toContain("safe");
    });
});

describe("recovery", () => {
    it("skips corrupt, incompatible and oversized lines while reporting each one", async (t) => {
        const dir = await temporary(t);
        await fs.writeFile(
            path.join(dir, "decisions.jsonl"),
            [
                JSON.stringify(record("a")),
                "{bad",
                JSON.stringify(record("v2", { version: 2 })),
                JSON.stringify({ version: 1 }),
                "x".repeat(100000),
                JSON.stringify(record("b")),
            ].join("\n") + "\n",
        );
        const log = warnings();
        const journal = new DecisionJournal(dir, journalOptions, log.warn);
        t.onTestFinished(() => journal.close());
        expect((await journal.list({})).map((entry) => entry.id)).toStrictEqual(["a", "b"]);
        expect(log.collected).toContainEqual(expect.stringMatching(/incompatible version/));
        expect(log.collected).toContainEqual(expect.stringMatching(/corrupt or missing/));
        expect(log.collected).toContainEqual(expect.stringMatching(/oversized/));
        // Compaction drops what was skipped, so the file cannot grow past the cap.
        await journal.flush();
        expect((await fs.stat(path.join(dir, "decisions.jsonl"))).size).toBeLessThanOrEqual(journalOptions.maxBytes);
    });

    it("discards an unterminated final line and rewrites the file without it", async (t) => {
        const dir = await temporary(t);
        await fs.writeFile(path.join(dir, "decisions.jsonl"), JSON.stringify(record("a")) + "\n" + JSON.stringify(record("partial")));
        const log = warnings();
        const journal = new DecisionJournal(dir, journalOptions, log.warn);
        t.onTestFinished(() => journal.close());
        expect((await journal.list({})).map((entry) => entry.id)).toStrictEqual(["a"]);
        expect(log.collected).toContainEqual(expect.stringMatching(/incomplete final record/));
        expect(parseJsonl(await fs.readFile(journal.filePath, "utf8")).map((line) => line.id)).toStrictEqual(["a"]);
    });

    it("refuses a symlinked journal without overwriting its target", async (t) => {
        const dir = await temporary(t);
        const external = path.join(dir, "outside.jsonl");
        await fs.writeFile(external, "DO_NOT_TOUCH");
        await fs.symlink(external, path.join(dir, "decisions.jsonl"));
        const log = warnings();
        const journal = new DecisionJournal(dir, journalOptions, log.warn);
        await journal.append(record("a"));
        await journal.close();
        expect(await fs.readFile(external, "utf8")).toBe("DO_NOT_TOUCH");
        expect(log.collected).toContainEqual(expect.stringMatching(/initialization failed/));
    });
});

describe("failure isolation", () => {
    it("never rejects realtime calls when writing fails and the warning sink throws", async (t) => {
        const dir = await temporary(t);
        const filename = path.join(dir, "not-a-directory");
        await fs.writeFile(filename, "occupied");
        const journal = new DecisionJournal(filename, journalOptions, () => {
            throw new Error("logger unavailable");
        });
        await expect(journal.append(record("a"))).resolves.toBeUndefined();
        await expect(journal.flush()).resolves.toBeUndefined();
        await expect(journal.close()).resolves.toBeUndefined();
        expect(journal.diagnostics.writeFailures).toBeGreaterThan(0);
    });

    it("releases the lock when initialization fails", async (t) => {
        const dir = await temporary(t);
        // A directory where the journal file belongs fails recovery after the lock was taken.
        await fs.mkdir(path.join(dir, "decisions.jsonl"));
        const failed = new DecisionJournal(dir, journalOptions);
        await failed.close();
        await expect(fs.stat(path.join(dir, ".decisions.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("releases the lock when a fresh instance closes immediately", async (t) => {
        const dir = await temporary(t);
        const immediate = new DecisionJournal(dir, journalOptions);
        await immediate.close();
        await expect(fs.stat(path.join(dir, ".decisions.lock"))).rejects.toMatchObject({ code: "ENOENT" });
        const restarted = new DecisionJournal(dir, journalOptions);
        t.onTestFinished(() => restarted.close());
        await restarted.append(record("new"));
        // The closed instance stays inert: flushing it must not disturb the new writer.
        await immediate.flush();
        expect((await restarted.list()).map((entry) => entry.id)).toStrictEqual(["new"]);
    });

    it("releases the lock even when the final flush fails", async (t) => {
        const dir = await temporary(t);
        const log = warnings();
        const journal = new DecisionJournal(dir, journalOptions, log.warn);
        await journal.append(record("before-failure"));
        await fs.unlink(journal.filePath);
        await expect(journal.close()).resolves.toBeUndefined();
        expect(log.collected).toContainEqual(expect.stringMatching(/I\/O failed/));
        await expect(fs.stat(path.join(dir, ".decisions.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("warns clearly and stays isolated when releasing the lock fails", async (t) => {
        const dir = await temporary(t);
        const log = warnings();
        const journal = new DecisionJournal(dir, journalOptions, log.warn);
        await journal.append(record("saved"));
        await fs.unlink(path.join(dir, ".decisions.lock"));
        await fs.mkdir(path.join(dir, ".decisions.lock"));
        await expect(journal.close()).resolves.toBeUndefined();
        expect(log.collected).toContainEqual(expect.stringMatching(releaseFailed));
        expect(journal.diagnostics.writeFailures).toBeGreaterThan(0);
    });
});

describe("exclusion", () => {
    it("disables a second writer in the same process before recovery or compaction", async (t) => {
        const dir = await temporary(t);
        const first = new DecisionJournal(dir, { ...journalOptions, maxEntries: 2 });
        t.onTestFinished(() => first.close());
        await first.append(record("a"));
        const log = warnings();
        const second = new DecisionJournal(dir, { ...journalOptions, maxEntries: 1 }, log.warn);
        t.onTestFinished(() => second.close());
        await second.append(record("b"));
        expect(log.collected).toContainEqual(expect.stringMatching(locked));
        expect(await second.list()).toStrictEqual([]);
        expect(second.diagnostics.droppedRecords).toBe(1);
        await first.append(record("c"));
        await first.append(record("d"));
        await second.close();
        expect(parseJsonl(await fs.readFile(first.filePath, "utf8")).map((line) => line.id)).toStrictEqual(["c", "d"]);
        // Closing the rejected writer must not release the first writer's lock.
        const third = new DecisionJournal(dir, journalOptions, log.warn);
        await third.append(record("e"));
        expect(await third.list()).toStrictEqual([]);
        await third.close();
        await first.close();
        const restarted = new DecisionJournal(dir, journalOptions);
        t.onTestFinished(() => restarted.close());
        await restarted.append(record("f"));
        expect((await restarted.list()).map((entry) => entry.id)).toStrictEqual(["c", "d", "f"]);
    });

    it("excludes another process from the same directory", async (t) => {
        const dir = await temporary(t);
        const first = new DecisionJournal(dir, journalOptions);
        t.onTestFinished(() => first.close());
        await first.append(record("parent"));
        const child = runChild(dir, "list", [record("child")]);
        assertCleanExit(child);
        expect(child.stderr).toMatch(locked);
        expect(JSON.parse(child.stdout)).toStrictEqual([]);
        await first.append(record("still-parent"));
        expect((await first.list()).map((entry) => entry.id)).toStrictEqual(["parent", "still-parent"]);
    });

    it("names the current owner in lock diagnostics without deleting the lock", async (t) => {
        const dir = await temporary(t);
        const log = warnings();
        const owner = new DecisionJournal(dir, journalOptions);
        t.onTestFinished(() => owner.close());
        await owner.list({});
        const blocked = new DecisionJournal(dir, journalOptions, log.warn);
        t.onTestFinished(() => blocked.close());
        await blocked.list({});
        expect(log.collected.some((message) => message.includes(`PID=${process.pid}`) && message.includes("当前进程"))).toBe(true);
        expect(JSON.parse(await fs.readFile(path.join(dir, ".decisions.lock"), "utf8")).pid).toBe(process.pid);
    });

    it("keeps history intact after an abnormal exit and waits for manual lock cleanup", async (t) => {
        const dir = await temporary(t);
        const child = runChild(dir, "exit", [record("before-crash")]);
        assertCleanExit(child);
        const original = await fs.readFile(path.join(dir, "decisions.jsonl"), "utf8");
        const log = warnings();
        const blocked = new DecisionJournal(dir, journalOptions, log.warn);
        await blocked.append(record("blocked"));
        await blocked.close();
        expect(log.collected).toContainEqual(expect.stringMatching(staleLock));
        expect(await fs.readFile(path.join(dir, "decisions.jsonl"), "utf8")).toBe(original);
        // The child has exited and the rejected instance is closed, so reclaiming is safe.
        await fs.unlink(path.join(dir, ".decisions.lock"));
        const restored = new DecisionJournal(dir, journalOptions);
        t.onTestFinished(() => restored.close());
        expect((await restored.list()).map((entry) => entry.id)).toStrictEqual(["before-crash"]);
    });
});

it("retains only approved balanced trace fields across persistence", async (t) => {
    const dir = await temporary(t);
    const journal = new DecisionJournal(dir, journalOptions);
    t.onTestFinished(() => journal.close());
    await journal.append(
        record("balanced", {
            decision: false,
            calculation: {
                before: 80,
                after: 68,
                baseScore: 12,
                interestMultiplier: 1,
                marginalMultiplier: 1,
                dynamicMultiplier: 1,
                assessmentMultiplier: 1,
                participationMultiplier: 1,
                effectiveGain: -12,
                maxWillingness: 100,
                threshold: 55,
                amplifier: 0.04,
                probability: 0,
                policy: {
                    version: "balanced-v1",
                    invited: false,
                    addressesOthers: true,
                    preview: false,
                    decay: 0,
                    positiveGain: 0,
                    negativeGain: 12,
                    fatiguePenalty: 0,
                    requestedGain: 12,
                    limitedGain: 0,
                    ordinaryGainRemaining: 24,
                    negativeGainRemaining: 12,
                    rawProbability: 0.52,
                    gate: "opportunity_interval",
                    content: "private text",
                },
            },
        }),
    );
    await journal.close();
    const log = warnings();
    const restored = new DecisionJournal(dir, journalOptions, log.warn);
    t.onTestFinished(() => restored.close());
    const trace = (await restored.list({}))[0].calculation?.policy;
    expect(trace).toMatchObject({ version: "balanced-v1", negativeGain: 12, gate: "opportunity_interval" });
    expect(trace).not.toHaveProperty("content");
    expect(log.collected).toEqual([]);
});
