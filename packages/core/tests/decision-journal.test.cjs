const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");
const Module = require("node:module");

function loadJournal() {
    const filename = path.resolve(__dirname, "../src/agent/decision-journal.ts");
    const source = require("node:fs").readFileSync(filename, "utf8");
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = module.paths;
    mod._compile(code, filename);
    return mod.exports.DecisionJournal;
}

const options = { maxEntries: 3, maxBytes: 4096, retentionHours: 24 };
function record(id, extra = {}) {
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
    };
}
async function temporary(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "decision-journal-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    return dir;
}

test("serial writes, restart recovery, filters and private permissions", async (t) => {
    const DecisionJournal = loadJournal();
    const dir = await temporary(t);
    const journal = new DecisionJournal(dir, options);
    t.after(() => journal.close());
    const now = Date.now();
    await Promise.all([
        journal.append(record("a", { time: now - 10 })),
        journal.append(record("b", { key: "other", time: now })),
        journal.append(record("c", { time: now + 10 })),
    ]);
    assert.deepEqual(
        (await journal.list({ key: "onebot:channel", from: now, to: now + 20 })).map((r) => r.id),
        ["c"]
    );
    await journal.close();
    assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(dir, "decisions.jsonl"))).mode & 0o777, 0o600);
    const restored = new DecisionJournal(dir, options);
    t.after(() => restored.close());
    assert.deepEqual(
        (await restored.list({ limit: 2 })).map((r) => r.id),
        ["b", "c"]
    );
    await restored.close();
    await restored.append(record("closed"));
    assert.equal((await restored.list({})).length, 3);
});

test("entry, byte and retention caps survive reopening", async (t) => {
    const DecisionJournal = loadJournal();
    const dir = await temporary(t);
    const journal = new DecisionJournal(dir, { ...options, maxEntries: 2, maxBytes: 400 });
    t.after(() => journal.close());
    await journal.append(record("expired", { time: Date.now() - 25 * 3600000 }));
    for (const id of ["a", "b", "c", "d"]) await journal.append(record(id));
    await journal.flush();
    const records = await journal.list({});
    assert.ok(records.length <= 2);
    assert.equal(records.at(-1).id, "d");
    assert.ok((await fs.stat(path.join(dir, "decisions.jsonl"))).size <= 400);
    assert.ok(!records.some((r) => r.id === "expired"));
    await journal.close();
    const recovered = new DecisionJournal(dir, { ...options, maxEntries: 2, maxBytes: 400 });
    t.after(() => recovered.close());
    assert.deepEqual(await recovered.list({}), records);
});

test("only structured metadata is persisted; arbitrary errors and nested secrets are discarded", async (t) => {
    const DecisionJournal = loadJournal();
    const dir = await temporary(t);
    const journal = new DecisionJournal(dir, options);
    t.after(() => journal.close());
    await journal.append(
        record("safe", {
            content: "SECRET_BODY",
            prompt: "SECRET_PROMPT",
            headers: { authorization: "SECRET_TOKEN" },
            error: "SECRET_ERROR",
            assessment: { reason: "SECRET_ASSESSMENT" },
            target: { content: "SECRET_TARGET" },
        })
    );
    await journal.append(record("badreason", { reason: "SECRET_REASON" }));
    await journal.append(record("badstage", { stage: "SECRET_STAGE" }));
    await journal.flush();
    const stored = await fs.readFile(path.join(dir, "decisions.jsonl"), "utf8");
    assert.ok(!stored.includes("SECRET"));
    assert.ok(stored.includes("safe"));
});

test("stream recovery reports damaged, incompatible and oversized lines without retaining them", async (t) => {
    const DecisionJournal = loadJournal();
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
        ].join("\n") + "\n"
    );
    const warnings = [];
    const journal = new DecisionJournal(dir, options, (message) => warnings.push(message));
    t.after(() => journal.close());
    assert.deepEqual(
        (await journal.list({})).map((r) => r.id),
        ["a", "b"]
    );
    assert.ok(warnings.some((m) => /version/i.test(m)));
    assert.ok(warnings.some((m) => /corrupt|invalid|missing/i.test(m)));
    assert.ok(warnings.some((m) => /oversiz|large/i.test(m)));
    await journal.flush();
    assert.ok((await fs.stat(path.join(dir, "decisions.jsonl"))).size <= options.maxBytes);
});

test("write failures and throwing warning callbacks do not reject realtime calls", async (t) => {
    const DecisionJournal = loadJournal();
    const dir = await temporary(t);
    const filename = path.join(dir, "not-a-directory");
    await fs.writeFile(filename, "occupied");
    const journal = new DecisionJournal(filename, options, () => {
        throw new Error("logger unavailable");
    });
    await assert.doesNotReject(journal.append(record("a")));
    await assert.doesNotReject(journal.flush());
    await assert.doesNotReject(journal.close());
});

test("symlink journals are rejected without overwriting their target", async (t) => {
    const DecisionJournal = loadJournal();
    const dir = await temporary(t);
    const external = path.join(dir, "outside.jsonl");
    const sentinel = "DO_NOT_TOUCH";
    await fs.writeFile(external, sentinel);
    await fs.symlink(external, path.join(dir, "decisions.jsonl"));
    const warnings = [];
    const journal = new DecisionJournal(dir, options, (message) => warnings.push(message));
    await journal.append(record("a"));
    await journal.close();
    assert.equal(await fs.readFile(external, "utf8"), sentinel);
    assert.ok(warnings.length);
});

test("bounded write backlog drops records with a warning and list returns detached snapshots", async (t) => {
    const DecisionJournal = loadJournal();
    const dir = await temporary(t);
    const warnings = [];
    const journal = new DecisionJournal(dir, { ...options, maxEntries: 2 }, (message) => warnings.push(message));
    t.after(() => journal.close());
    await Promise.all(Array.from({ length: 100 }, (_, i) => journal.append(record(`id-${i}`))));
    assert.equal((await journal.list({})).length, 2);
    assert.ok(warnings.some((message) => message.includes("queue is full")));
    assert.equal(journal.diagnostics.droppedRecords, 98);
    const snapshot = await journal.list({});
    snapshot[0].key = "mutated";
    assert.equal((await journal.list({}))[0].key, "onebot:channel");
    assert.deepEqual(await journal.list({ limit: 0 }), []);
});

test("a truncated final line is reported and removed during recovery", async (t) => {
    const DecisionJournal = loadJournal();
    const dir = await temporary(t);
    await fs.writeFile(path.join(dir, "decisions.jsonl"), JSON.stringify(record("a")) + "\n" + JSON.stringify(record("partial")));
    const warnings = [];
    const journal = new DecisionJournal(dir, options, (message) => warnings.push(message));
    t.after(() => journal.close());
    assert.deepEqual(
        (await journal.list({})).map((r) => r.id),
        ["a"]
    );
    assert.ok(warnings.some((message) => message.includes("incomplete final record")));
});

function replay(filename, args = []) {
    return spawnSync(process.execPath, [path.resolve(__dirname, "../scripts/replay-decisions.cjs"), filename, ...args], {
        encoding: "utf8",
    });
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

test("offline replay reproduces gain and original roll, reports skipped events and independent scenarios", async (t) => {
    const dir = await temporary(t);
    const filename = path.join(dir, "decisions.jsonl");
    await fs.writeFile(
        filename,
        [
            record("calc", { calculation }),
            record("scheduled", { stimulusType: "scheduled_task", stage: "scheduled" }),
            record("incomplete", { calculation: { before: 0 } }),
            record("v2", { version: 2 }),
            { version: 1 },
            "broken",
        ]
            .map((r) => (typeof r === "string" ? r : JSON.stringify(r)))
            .join("\n") + "\n"
    );
    const result = replay(filename);
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    const calc = lines.find((line) => line.id === "calc");
    assert.equal(calc.recomputed.effectiveGain, 12);
    assert.equal(calc.recomputed.after, 22);
    assert.equal(calc.recomputed.decision, true);
    assert.equal(calc.matches, true);
    assert.equal(lines.find((line) => line.id === "scheduled").status, "no_calculation");
    assert.equal(lines.at(-1).summary.missingCalculation, 2);
    assert.equal(lines.at(-1).summary.incompatible, 1);
    assert.equal(lines.at(-1).summary.corrupt, 2);
    const scenario = replay(filename, ["--threshold", "30", "--amplifier", "0.2"]);
    assert.equal(scenario.status, 0, scenario.stderr);
    const scenarioLines = scenario.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    assert.equal(scenarioLines.find((line) => line.id === "calc").scenario.decision, false);
    assert.equal(scenarioLines.find((line) => line.id === "calc").scenario.roll, calculation.roll);
    assert.equal(scenarioLines.at(-1).summary.scenarioMode, "independent_records_not_full_trajectory");
});

test("offline replay filters and fails clearly for invalid options or missing file", async (t) => {
    const dir = await temporary(t);
    const filename = path.join(dir, "decisions.jsonl");
    const time = Date.parse("2026-09-30T12:00:00Z");
    await fs.writeFile(
        filename,
        [
            record("inside", { time, calculation }),
            record("other", { key: "other", time, calculation }),
            record("old", { time: time - 3600000, calculation }),
        ]
            .map((r) => JSON.stringify(r))
            .join("\n") + "\n"
    );
    const result = replay(filename, ["--key", "onebot:channel", "--from", "2026-09-30T11:59:00Z", "--to", "2026-09-30T12:01:00Z"]);
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    assert.deepEqual(
        lines.filter((line) => line.id).map((line) => line.id),
        ["inside"]
    );
    assert.notEqual(replay(filename, ["--threshold", "NaN"]).status, 0);
    assert.notEqual(replay(filename, ["--from", "invalid"]).status, 0);
    assert.notEqual(replay(path.join(dir, "absent")).status, 0);
});

test("replay counts one calculation per decision ID, preferring calculated snapshots", async (t) => {
    const dir = await temporary(t);
    const filename = path.join(dir, "decisions.jsonl");
    await fs.writeFile(
        filename,
        [
            record("same", { stage: "completed", calculation: { ...calculation, roll: 0.9 }, decision: false }),
            record("same", { stage: "calculated", calculation }),
            record("same", { stage: "completed", calculation }),
            record("fallback", { stage: "completed", calculation }),
            record("fallback", { stage: "completed", calculation }),
        ]
            .map((r) => JSON.stringify(r))
            .join("\n") + "\n"
    );
    const result = replay(filename);
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    assert.equal(lines.at(-1).summary.replayed, 2);
    assert.equal(lines.at(-1).summary.duplicateCalculations, 3);
    assert.equal(lines.find((line) => line.id === "same" && line.status === "replayed").stage, "calculated");
    assert.equal(lines.find((line) => line.id === "same" && line.status === "replayed").recomputed.roll, 0.15);
    assert.equal(lines.at(-1).summary.replayMode, "independent_records_not_full_trajectory");
});

test("replay bounds oversized lines, hides unapproved metadata and handles zero-probability boundary", async (t) => {
    const dir = await temporary(t);
    const filename = path.join(dir, "decisions.jsonl");
    const boundary = { ...calculation, threshold: 22, probability: 0, roll: 0 };
    await fs.writeFile(
        filename,
        "x".repeat(2 * 1024 * 1024) +
            "\n" +
            JSON.stringify(
                record("boundary", {
                    decision: false,
                    calculation: boundary,
                    stage: "SECRET_STAGE",
                    reason: "SECRET_REASON",
                    content: "SECRET_BODY",
                })
            ) +
            "\n{partial"
    );
    const result = replay(filename);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes("SECRET"));
    const lines = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    assert.equal(lines[0].recomputed.probability, 0);
    assert.equal(lines[0].recomputed.decision, false);
    assert.equal(lines.at(-1).summary.oversized, 1);
    assert.equal(lines.at(-1).summary.corrupt, 1);
});

test("replay preserves live multiplication order at an exact random-roll boundary", async (t) => {
    const dir = await temporary(t);
    const filename = path.join(dir, "decisions.jsonl");
    const precise = {
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
    await fs.writeFile(filename, JSON.stringify(record("precise", { calculation: precise, decision: false })) + "\n");
    const result = replay(filename);
    assert.equal(result.status, 0, result.stderr);
    const event = JSON.parse(result.stdout.split("\n")[0]);
    assert.equal(event.matches, true);
    assert.equal(event.recomputed.decision, false);
    assert.equal(event.recomputed.probability, precise.probability);
});
