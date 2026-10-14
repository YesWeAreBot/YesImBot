import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import sqlite from "@minatojs/driver-sqlite";
import { Context } from "koishi";
import type { TaskContext } from "vitest";

const groups = new WeakMap();

// Creates the application without starting it; the caller decides when to
// call app.start(), which matters for hooks that must be registered first
// (post-start middleware registration is not picked up by the aliased koishi).
export async function fixtureContext(t: TaskContext, register: (app: Context) => void) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yib-person-"));
    const app = new Context({ baseDir: dir });
    app.plugin(sqlite, { path: path.join(dir, "memory.db") });
    register(app);
    const group = { dir, apps: [app] };
    groups.set(app, group);
    t.onTestFinished(async () => {
        for (const instance of group.apps) await instance.stop();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    return app;
}

export async function fixture(t: TaskContext, register: (app: Context) => void) {
    const app = await fixtureContext(t, register);
    await app.start();
    await app.database.prepared();
    return app;
}

export async function reopen(app: Context, register: (app: Context) => void) {
    const group = groups.get(app);
    await app.stop();
    const next = new Context({ baseDir: group.dir });
    next.plugin(sqlite, { path: path.join(group.dir, "memory.db") });
    register(next);
    await next.start();
    await next.database.prepared();
    group.apps.push(next);
    groups.set(next, group);
    return next;
}
