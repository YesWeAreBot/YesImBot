const { buildSync } = require("esbuild");
const Module = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { Context } = require("koishi");
const sqlite = require("@minatojs/driver-sqlite").default;
function load(name) {
    const file = path.join(__dirname, "../src", name + ".ts");
    const js = buildSync({ entryPoints: [file], bundle: true, write: false, platform: "node", format: "cjs", external: ["koishi"] }).outputFiles[0].text;
    const mod = new Module(file, module);
    mod.filename = file;
    mod.paths = Module._nodeModulePaths(path.dirname(file));
    mod._compile(js, file);
    return mod.exports;
}
async function database(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yib-directory-"));
    const app = new Context({ baseDir: dir });
    app.plugin(sqlite, { path: path.join(dir, "contacts.db") });
    load("store").registerModels(app);
    await app.start();
    await app.database.prepared();
    t.after(async () => {
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
function gate() {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
}
module.exports = { load, database, gate };
