#!/usr/bin/env node
"use strict";

// Child process for the cross-process cases in decision-journal.spec.ts: the
// journal's exclusion and crash-recovery guarantees cannot be reproduced inside
// the vitest worker. Node cannot require the TypeScript source directly
// (parameter properties are not erasable syntax), so it is transpiled here.

const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const [directory, command, payload] = process.argv.slice(2);

if (!directory || !["list", "exit"].includes(command) || !payload) {
    console.error("Usage: node decision-journal-child.cjs <directory> <list|exit> <json>");
    process.exit(2);
}

function loadJournal() {
    const filename = path.join(__dirname, "../../src/agent/decision-journal.ts");
    const source = fs.readFileSync(filename, "utf8");
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = module.paths;
    mod._compile(code, filename);
    return mod.exports.DecisionJournal;
}

const { options, records } = JSON.parse(payload);
const DecisionJournal = loadJournal();
const journal = new DecisionJournal(directory, options, (message) => console.error(message));

(async () => {
    for (const record of records) await journal.append(record);
    // `exit` walks away without releasing the lock, which is the crash a real
    // deployment can suffer between the write and the cleanup.
    if (command === "exit") process.exit(0);
    console.log(JSON.stringify(await journal.list()));
    await journal.close();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
