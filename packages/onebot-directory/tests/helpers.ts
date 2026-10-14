import memory from "@koishijs/plugin-database-memory";
import { Context } from "koishi";
import type { TaskContext } from "vitest";

import { registerModels } from "../src/store";

export async function database(t: TaskContext) {
    const app = new Context();
    app.plugin(memory);
    registerModels(app);
    await app.start();
    await app.database.prepared();
    t.onTestFinished(() => app.stop());
    // Wrappers control return timing while every operation still runs on the database.
    const db = new Proxy(app.database, {
        get(target, key) {
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    return { database: db, logger: { warn() {} }, app };
}

export function gate() {
    return Promise.withResolvers<void>();
}
