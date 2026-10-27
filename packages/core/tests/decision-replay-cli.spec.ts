// Contract of the shipped offline replay entry point: stdout carries one JSON
// object per line, the last line summarizes the run, and the exit code reports
// unusable input. Each case drives the real script through spawnSync.

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { assertCleanExit, parseJsonl, record, temporary } from "./helpers/decision-fixtures";

const replayScript = path.resolve(import.meta.dirname, "../scripts/replay-decisions.cjs");

function replay(filename: string, args: string[] = []) {
    return spawnSync(process.execPath, [replayScript, filename, ...args], { encoding: "utf8" });
}

const calculation = {
    before: 10,
    after: 22,
    baseScore: 8,
    interestMultiplier: 2,
    marginalMultiplier: 0.5,
    dynamicMultiplier: 2,
    assessmentMultiplier: 0.75,
    participationMultiplier: 1,
    effectiveGain: 12,
    maxWillingness: 100,
    threshold: 20,
    amplifier: 0.1,
    probability: 0.2,
    roll: 0.15,
};

async function writeLog(filename: string, lines: unknown[]) {
    await fs.writeFile(filename, lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n") + "\n");
}

describe("offline replay", () => {
    it("reproduces gain and the original roll, and reports skipped events", async (t) => {
        const dir = await temporary(t);
        const filename = path.join(dir, "decisions.jsonl");
        await writeLog(filename, [
            record("calc", { calculation }),
            record("scheduled", { stimulusType: "scheduled_task", stage: "scheduled" }),
            record("incomplete", { calculation: { before: 0 } }),
            record("v2", { version: 2 }),
            { version: 1 },
            "broken",
        ]);
        const result = replay(filename);
        assertCleanExit(result);
        const lines = parseJsonl(result.stdout);
        const calc = lines.find((line) => line.id === "calc")!;
        expect(calc.recomputed.effectiveGain).toBe(12);
        expect(calc.recomputed.after).toBe(22);
        expect(calc.recomputed.decision).toBe(true);
        expect(calc.matches).toBe(true);
        expect(lines.find((line) => line.id === "scheduled")!.status).toBe("no_calculation");
        expect(lines.at(-1)!.summary.missingCalculation).toBe(2);
        expect(lines.at(-1)!.summary.incompatible).toBe(1);
        expect(lines.at(-1)!.summary.corrupt).toBe(2);
        // Scenario overrides recompute each record on its own, keeping the recorded roll.
        const scenario = replay(filename, ["--threshold", "30", "--amplifier", "0.2"]);
        assertCleanExit(scenario);
        const scenarioLines = parseJsonl(scenario.stdout);
        expect(scenarioLines.find((line) => line.id === "calc")!.scenario.decision).toBe(false);
        expect(scenarioLines.find((line) => line.id === "calc")!.scenario.roll).toBe(calculation.roll);
        expect(scenarioLines.at(-1)!.summary.scenarioMode).toBe("independent_records_not_full_trajectory");
    });

    it("filters records and fails clearly for invalid options or a missing file", async (t) => {
        const dir = await temporary(t);
        const filename = path.join(dir, "decisions.jsonl");
        const time = Date.parse("2026-09-30T12:00:00Z");
        await writeLog(filename, [
            record("inside", { time, calculation }),
            record("other", { key: "other", time, calculation }),
            record("old", { time: time - 3600000, calculation }),
        ]);
        const result = replay(filename, ["--key", "onebot:channel", "--from", "2026-09-30T11:59:00Z", "--to", "2026-09-30T12:01:00Z"]);
        assertCleanExit(result);
        expect(
            parseJsonl(result.stdout)
                .filter((line) => line.id)
                .map((line) => line.id),
        ).toStrictEqual(["inside"]);
        expect(replay(filename, ["--threshold", "NaN"]).status).not.toBe(0);
        expect(replay(filename, ["--from", "invalid"]).status).not.toBe(0);
        expect(replay(path.join(dir, "absent")).status).not.toBe(0);
    });

    it("counts one calculation per decision ID, preferring the calculated snapshot", async (t) => {
        const dir = await temporary(t);
        const filename = path.join(dir, "decisions.jsonl");
        await writeLog(filename, [
            record("same", { stage: "completed", calculation: { ...calculation, roll: 0.9 }, decision: false }),
            record("same", { stage: "calculated", calculation }),
            record("same", { stage: "completed", calculation }),
            record("fallback", { stage: "completed", calculation }),
            record("fallback", { stage: "completed", calculation }),
        ]);
        const result = replay(filename);
        assertCleanExit(result);
        const lines = parseJsonl(result.stdout);
        expect(lines.at(-1)!.summary.replayed).toBe(2);
        expect(lines.at(-1)!.summary.duplicateCalculations).toBe(3);
        const replayed = lines.find((line) => line.id === "same" && line.status === "replayed")!;
        expect(replayed.stage).toBe("calculated");
        expect(replayed.recomputed.roll).toBe(0.15);
        expect(lines.at(-1)!.summary.replayMode).toBe("independent_records_not_full_trajectory");
    });

    it("bounds oversized lines, hides unapproved metadata and honors the zero-probability boundary", async (t) => {
        const dir = await temporary(t);
        const filename = path.join(dir, "decisions.jsonl");
        await writeLog(filename, [
            "x".repeat(2 * 1024 * 1024),
            record("boundary", {
                decision: false,
                calculation: { ...calculation, threshold: 22, probability: 0, roll: 0 },
                stage: "SECRET_STAGE",
                reason: "SECRET_REASON",
                content: "SECRET_BODY",
            }),
            "{partial",
        ]);
        const result = replay(filename);
        assertCleanExit(result);
        expect(result.stdout).not.toContain("SECRET");
        const lines = parseJsonl(result.stdout);
        expect(lines[0].recomputed.probability).toBe(0);
        expect(lines[0].recomputed.decision).toBe(false);
        expect(lines.at(-1)!.summary.oversized).toBe(1);
        expect(lines.at(-1)!.summary.corrupt).toBe(1);
    });

    it("preserves the live multiplication order at an exact random-roll boundary", async (t) => {
        const dir = await temporary(t);
        const filename = path.join(dir, "decisions.jsonl");
        // The recorded values are rounded, so regrouping the multiplications or
        // widening the comparison would flip this decision.
        const precise: Record<string, number> = {
            before: 11,
            baseScore: 12,
            interestMultiplier: 1.2,
            participationMultiplier: 1.3301609237864502,
            marginalMultiplier: 0.9879,
            dynamicMultiplier: 1,
            assessmentMultiplier: 1.33,
            maxWillingness: 100,
            threshold: 10,
            amplifier: 0.01,
        };
        precise.effectiveGain =
            precise.baseScore *
            precise.interestMultiplier *
            precise.participationMultiplier *
            precise.marginalMultiplier *
            precise.dynamicMultiplier *
            precise.assessmentMultiplier;
        precise.after = precise.before + precise.effectiveGain;
        precise.probability = (precise.after - precise.threshold) * precise.amplifier;
        precise.roll = precise.probability;
        await writeLog(filename, [record("precise", { calculation: precise, decision: false })]);
        const result = replay(filename);
        assertCleanExit(result);
        const event = parseJsonl(result.stdout)[0];
        expect(event.matches).toBe(true);
        expect(event.recomputed.decision).toBe(false);
        expect(event.recomputed.probability).toBe(precise.probability);
    });
});

it("replays balanced decay, penalties and gated records without a random draw", async (t) => {
    const dir = await temporary(t),
        filename = path.join(dir, "balanced.jsonl");
    const policy = { version: "balanced-v1", decay: 10, requestedGain: 12, positiveGain: 2, negativeGain: 0, fatiguePenalty: 5, gate: "none" };
    const balanced = { ...calculation, before: 80, after: 72, effectiveGain: 2, threshold: 55, amplifier: 0.04, probability: 0.48, policy };
    await writeLog(filename, [
        record("balanced", { calculation: balanced }),
        record("gated", {
            decision: false,
            calculation: { ...balanced, probability: 0, roll: undefined, policy: { ...policy, gate: "opportunity_interval" } },
        }),
    ]);
    const result = replay(filename);
    assertCleanExit(result);
    const lines = parseJsonl(result.stdout);
    expect(lines.filter((line) => line.status === "replayed").map((line) => line.matches)).toEqual([true, true]);
    expect(lines.at(-1)!.summary.mismatches).toBe(0);
});

it("deduplicates balanced gated snapshots and leaves positive scenarios without a roll undecided", async (t) => {
    const dir = await temporary(t),
        filename = path.join(dir, "gated.jsonl");
    const balanced = {
        ...calculation,
        before: 50,
        after: 50,
        effectiveGain: 0,
        threshold: 55,
        amplifier: 0.04,
        probability: 0,
        roll: undefined,
        policy: { version: "balanced-v1", decay: 0, requestedGain: 12, positiveGain: 0, negativeGain: 0, fatiguePenalty: 0, gate: "none" },
    };
    await writeLog(filename, [
        record("same", { stage: "completed", decision: false, calculation: balanced }),
        record("same", { stage: "calculated", decision: false, calculation: balanced }),
    ]);
    const result = replay(filename, ["--threshold", "10"]);
    assertCleanExit(result);
    const lines = parseJsonl(result.stdout);
    expect(lines.at(-1)!.summary).toMatchObject({ replayed: 1, duplicateCalculations: 1, mismatches: 0 });
    const event = lines.find((line) => line.status === "replayed")!;
    expect(event.scenario.probability).toBe(1);
    expect(event.scenario).not.toHaveProperty("decision");
});
it("replays explicit continuation bonuses with either algorithm", async (t) => {
    const dir = await temporary(t),
        filename = path.join(dir, "continuation.jsonl");
    await writeLog(filename, [
        record("legacy-bonus", { calculation: { ...calculation, continuationGain: 5, effectiveGain: 17, after: 27, probability: 0.7 } }),
        record("balanced-bonus", {
            calculation: {
                ...calculation,
                before: 80,
                after: 77,
                effectiveGain: 7,
                continuationGain: 5,
                threshold: 55,
                amplifier: 0.04,
                probability: 0.68,
                policy: { version: "balanced-v1", decay: 10, requestedGain: 12, positiveGain: 2, negativeGain: 0, fatiguePenalty: 5, gate: "none" },
            },
        }),
    ]);
    const result = replay(filename);
    assertCleanExit(result);
    expect(
        parseJsonl(result.stdout)
            .filter((line) => line.status === "replayed")
            .map((line) => line.matches),
    ).toEqual([true, true]);
});
