import memory from "@koishijs/plugin-database-memory";
import { Context } from "koishi";
import type { TaskContext } from "vitest";

// The in-memory driver looks for an existing row with a separate read before it
// inserts, so two concurrent inserts of the same primary key both succeed, while
// a SQL engine rejects the second one. The store's commit protocol arbitrates on
// that rejection, so serialize create() per table to keep the guarantee.
function atomicCreates(database: Context["database"]) {
    const create = database.create.bind(database);
    const tails = new Map<string, Promise<unknown>>();
    database.create = (table, data) => {
        const run = (tails.get(String(table)) ?? Promise.resolve()).then(() => create(table, data));
        tails.set(
            String(table),
            run.catch(() => {}),
        );
        return run;
    };
}

// Creates the application without starting it; the caller decides when to
// call app.start(), which matters for hooks that must be registered first
// (post-start middleware registration is not picked up by the aliased koishi).
export async function fixtureContext(t: TaskContext, register: (app: Context) => void) {
    const app = new Context();
    app.plugin(memory);
    register(app);
    t.onTestFinished(() => app.stop());
    return app;
}

export async function fixture(t: TaskContext, register: (app: Context) => void) {
    const app = await fixtureContext(t, register);
    await app.start();
    await app.database.prepared();
    atomicCreates(app.database);
    return app;
}
