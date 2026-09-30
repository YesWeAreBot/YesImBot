#!/usr/bin/env node
"use strict";

// Deliberately standalone: this entry point loads only Node built-ins.
const fs = require("node:fs");
const { once } = require("node:events");
const stages = new Set([
    "received",
    "assessing",
    "calculated",
    "scheduled",
    "debounced",
    "queued",
    "deferred",
    "skipped",
    "running",
    "completed",
    "cancelled",
    "blocked",
    "failed",
]);
const stimuli = new Set(["user_message", "scheduled_task", "background_task_completion", "system_event", "cancellation"]);
const reasons = new Set([
    "stopped",
    "reply_suppressed",
    "permission_denied",
    "muted",
    "probability_roll",
    "below_threshold",
    "busy",
    "debounce_replaced",
    "assessment_replaced",
    "pause",
    "resume",
    "replace",
    "expired",
    "no_reply",
    "exception",
    "disposed",
    "not_scheduled",
    "invalid_generation",
]);
const fields = [
    "before",
    "after",
    "baseScore",
    "interestMultiplier",
    "marginalMultiplier",
    "dynamicMultiplier",
    "assessmentMultiplier",
    "participationMultiplier",
    "effectiveGain",
    "maxWillingness",
    "threshold",
    "amplifier",
    "probability",
    "roll",
];
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const identifier = (value) => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const usage =
    "Usage: node scripts/replay-decisions.cjs <file> [--key KEY] [--from ISO] [--to ISO] [--threshold NUMBER] [--amplifier NUMBER]";

function parseOptions(args) {
    if (args.length === 1 && ["--help", "-h"].includes(args[0])) return { help: true };
    if (!args[0] || args[0].startsWith("--")) throw new Error("A JSONL file is required.");
    const options = { filename: args[0] };
    const seen = new Set();
    for (let index = 1; index < args.length; index += 2) {
        const name = args[index];
        const value = args[index + 1];
        if (!["--key", "--from", "--to", "--threshold", "--amplifier"].includes(name) || value === undefined || seen.has(name))
            throw new Error("Unknown, duplicate or incomplete option.");
        seen.add(name);
        const field = name.slice(2);
        if (field === "key") {
            if (!identifier(value)) throw new Error("Key must be a nonempty identifier.");
            options.key = value;
        } else if (field === "from" || field === "to") {
            if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
                throw new Error("Time bounds must be ISO timestamps with a timezone.");
            options[field] = Date.parse(value);
        } else {
            if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0)
                throw new Error("Scenario parameters must be finite nonnegative numbers.");
            options[field] = Number(value);
        }
    }
    if (options.from !== undefined && options.to !== undefined && options.from > options.to)
        throw new Error("The from bound must not exceed the to bound.");
    return options;
}

// Bounded line reading also handles damaged inputs containing a huge line.
async function* lines(filename) {
    let pending = Buffer.alloc(0);
    let oversized = false;
    for await (const chunk of fs.createReadStream(filename, { highWaterMark: 64 * 1024 })) {
        let offset = 0;
        while (offset < chunk.length) {
            const newline = chunk.indexOf(10, offset);
            const end = newline === -1 ? chunk.length : newline;
            const part = chunk.subarray(offset, end);
            if (!oversized) {
                if (pending.length + part.length > 1024 * 1024) {
                    oversized = true;
                    pending = Buffer.alloc(0);
                } else pending = Buffer.concat([pending, part]);
            }
            if (newline !== -1) {
                yield oversized ? { oversized: true } : { text: pending.toString("utf8") };
                pending = Buffer.alloc(0);
                oversized = false;
            }
            offset = end + (newline === -1 ? 0 : 1);
        }
    }
    if (oversized) yield { oversized: true };
    else if (pending.length) yield { incomplete: true };
}

function recompute(calculation, threshold = calculation.threshold, amplifier = calculation.amplifier) {
    const rawGain =
        calculation.baseScore * calculation.interestMultiplier * calculation.participationMultiplier * calculation.marginalMultiplier;
    const effectiveGain = rawGain * calculation.dynamicMultiplier * calculation.assessmentMultiplier;
    const after = Math.min(calculation.before + effectiveGain, calculation.maxWillingness);
    const probability = after > threshold ? Math.max(0, Math.min(1, (after - threshold) * amplifier)) : 0;
    return {
        rawGain,
        effectiveGain,
        after,
        threshold,
        amplifier,
        probability,
        roll: calculation.roll,
        decision: calculation.roll < probability,
    };
}

const approximately = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
async function output(value) {
    if (!process.stdout.write(JSON.stringify(value) + "\n")) await once(process.stdout, "drain");
}

async function replay(options) {
    // Index only IDs, never whole records. Refuse huge unique-ID sets explicitly.
    const preferred = new Map();
    for await (const line of lines(options.filename)) {
        if (line.text === undefined) continue;
        let record;
        try {
            record = JSON.parse(line.text);
        } catch {
            continue;
        }
        if (
            !object(record) ||
            record.version !== 1 ||
            !identifier(record.id) ||
            !identifier(record.key) ||
            !finite(record.time) ||
            typeof record.stage !== "string" ||
            typeof record.stimulusType !== "string"
        )
            continue;
        if (
            (options.key !== undefined && options.key !== record.key) ||
            (options.from !== undefined && record.time < options.from) ||
            (options.to !== undefined && record.time > options.to)
        )
            continue;
        if (
            !object(record.calculation) ||
            fields.some((field) => !finite(record.calculation[field])) ||
            typeof record.decision !== "boolean"
        )
            continue;
        if (!preferred.has(record.id)) {
            if (preferred.size >= 100000) throw Object.assign(new Error(), { code: "REPLAY_INDEX_LIMIT" });
            preferred.set(record.id, { calculated: false, replayed: false });
        }
        if (record.stage === "calculated") preferred.get(record.id).calculated = true;
    }
    const summary = {
        scanned: 0,
        matched: 0,
        replayed: 0,
        duplicateCalculations: 0,
        mismatches: 0,
        missingCalculation: 0,
        incompatible: 0,
        corrupt: 0,
        oversized: 0,
        unknownMetadata: 0,
        replayMode: "independent_records_not_full_trajectory",
    };
    const scenario = options.threshold !== undefined || options.amplifier !== undefined;
    if (scenario) summary.scenarioMode = "independent_records_not_full_trajectory";
    for await (const line of lines(options.filename)) {
        if (line.oversized) {
            summary.oversized++;
            continue;
        }
        if (line.incomplete) {
            summary.corrupt++;
            continue;
        }
        if (!line.text.trim()) continue;
        summary.scanned++;
        let record;
        try {
            record = JSON.parse(line.text);
        } catch {
            summary.corrupt++;
            continue;
        }
        if (object(record) && record.version !== 1) {
            summary.incompatible++;
            continue;
        }
        if (
            !object(record) ||
            !identifier(record.id) ||
            !identifier(record.key) ||
            !finite(record.time) ||
            record.time < 0 ||
            typeof record.stage !== "string" ||
            typeof record.stimulusType !== "string"
        ) {
            summary.corrupt++;
            continue;
        }
        if (
            (options.key !== undefined && options.key !== record.key) ||
            (options.from !== undefined && record.time < options.from) ||
            (options.to !== undefined && record.time > options.to)
        )
            continue;
        summary.matched++;
        const event = {
            id: record.id,
            key: record.key,
            time: record.time,
            stimulusType: stimuli.has(record.stimulusType) ? record.stimulusType : "unknown",
            stage: stages.has(record.stage) ? record.stage : "unknown",
        };
        if (event.stimulusType === "unknown" || event.stage === "unknown") summary.unknownMetadata++;
        if (reasons.has(record.reason)) event.reason = record.reason;
        if (typeof record.decision === "boolean") event.recordedDecision = record.decision;
        const calculation = record.calculation;
        const missing = fields.filter((field) => !object(calculation) || !finite(calculation[field]));
        if (missing.length || typeof record.decision !== "boolean") {
            summary.missingCalculation++;
            event.status = !object(calculation) ? "no_calculation" : "missing_calculation_data";
            event.missing = typeof record.decision !== "boolean" ? [...missing, "decision"] : missing;
            await output(event);
            continue;
        }
        const selection = preferred.get(record.id);
        if (selection?.replayed || (selection?.calculated && record.stage !== "calculated")) {
            summary.duplicateCalculations++;
            event.status = "duplicate_calculation";
            await output(event);
            continue;
        }
        event.recomputed = recompute(calculation);
        if (
            ![event.recomputed.rawGain, event.recomputed.effectiveGain, event.recomputed.after, event.recomputed.probability].every(
                finite
            ) ||
            calculation.roll < 0 ||
            calculation.roll >= 1 ||
            calculation.maxWillingness <= 0 ||
            calculation.probability < 0 ||
            calculation.probability > 1 ||
            calculation.amplifier < 0
        ) {
            summary.corrupt++;
            event.status = "invalid_calculation_data";
            delete event.recomputed;
            await output(event);
            continue;
        }
        summary.replayed++;
        if (selection) selection.replayed = true;
        event.status = "replayed";
        event.matches =
            approximately(calculation.effectiveGain, event.recomputed.effectiveGain) &&
            approximately(calculation.after, event.recomputed.after) &&
            approximately(calculation.probability, event.recomputed.probability) &&
            record.decision === event.recomputed.decision;
        if (!event.matches) summary.mismatches++;
        if (scenario)
            event.scenario = recompute(calculation, options.threshold ?? calculation.threshold, options.amplifier ?? calculation.amplifier);
        await output(event);
    }
    await output({ summary });
}

async function main() {
    let options;
    try {
        options = parseOptions(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(error.message + "\n" + usage + "\n");
        process.exitCode = 2;
        return;
    }
    if (options.help) {
        process.stdout.write(usage + "\n");
        return;
    }
    try {
        await replay(options);
    } catch (error) {
        process.stderr.write(
            error.code === "REPLAY_INDEX_LIMIT"
                ? "Replay index exceeds 100000 unique decisions; narrow the key/time filters or split the file.\n"
                : "Unable to read the decision file or write replay output.\n"
        );
        process.exitCode = 1;
    }
}

main();
