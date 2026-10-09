import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import sqlite from "@minatojs/driver-sqlite";
import { Context } from "koishi";
import type { TaskContext } from "vitest";

import { registerModels } from "../src/store";

export async function database(t: TaskContext) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yib-directory-"));
    const app = new Context({ baseDir: dir });
    app.plugin(sqlite, { path: path.join(dir, "contacts.db") });
    registerModels(app);
    await app.start();
    await app.database.prepared();
    t.onTestFinished(async () => {
        await app.stop();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    // Wrappers control return timing while every operation still runs on real SQLite.
    const db = new Proxy(app.database, {
        get(target, key) {
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    return { database: db, logger: { warn() {} }, app };
}

export function gate() {
    let resolve!: (value?: unknown) => void;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
}
