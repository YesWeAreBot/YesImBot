const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");
const Module = require("node:module");

function loadSource(relative, imports = {}) {
    const filename = path.resolve(__dirname, relative);
    const source = require("node:fs").readFileSync(filename, "utf8");
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = module.paths;
    const requireOriginal = Module.createRequire(filename);
    mod.require = (id) => imports[id] || requireOriginal(id);
    mod._compile(code, filename);
    return mod.exports;
}
const sanitizer = loadSource("../src/shared/diagnostic-sanitizer.ts");
const { LocalLogWriter } = loadSource("../src/services/logger/local-writer.ts", { "@/shared/diagnostic-sanitizer": sanitizer });

test("local files filter custom toJSON results before serialization", async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-tojson-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const secret = 'configured-"secret\\value';
    let invoked = 0;
    const payload = {
        safe: "preserved", Authorization: "unconfigured-auth", Cookie: "unconfigured-cookie", detail: secret,
        toJSON() { invoked++; return { Authorization: "Bearer regenerated-auth", Cookie: "session=regenerated-cookie", detail: secret, safe: "preserved", nested: { toJSON() { return { Cookie: "nested-cookie", callback() {} }; } } }; },
        callback() { return secret; },
    };
    const writer = new LocalLogWriter(directory, { enabled: true, directory: "logs", level: 3, maxFileSizeMB: 1, maxFiles: 2, retentionDays: 7 }, () => {}, [secret]);
    t.after(() => writer.close());
    await writer.write({ arguments: [payload] });
    await writer.close();
    const names = await fs.readdir(writer.directory);
    assert.equal(names.length, 1);
    const text = await fs.readFile(path.join(writer.directory, names[0]), "utf8");
    for (const marker of ["unconfigured-auth", "unconfigured-cookie", "regenerated-auth", "regenerated-cookie", "nested-cookie", secret, JSON.stringify(secret).slice(1, -1)]) assert.ok(!text.includes(marker), marker);
    assert.equal(invoked, 1);
    assert.equal(JSON.parse(text).arguments[0].nested.callback, "[Function]");
    assert.equal(JSON.parse(text).arguments[0].safe, "preserved");
    assert.equal(payload.Authorization, "unconfigured-auth");
});

test("getter, cycle, function and Date boundaries cannot reintroduce credentials", () => {
    let invoked = 0;
    const value = { safe: "safe", fn() { return "Bearer function-secret"; } };
    Object.defineProperty(value, "getter", { enumerable: true, get() { invoked++; return { Cookie: "getter-secret" }; } });
    Object.defineProperty(value, "toJSON", { enumerable: true, get() { invoked++; return () => ({ Cookie: "getter-json-secret" }); } });
    const items = [value];
    Object.defineProperty(items, "0", { enumerable: true, get() { invoked++; return { Authorization: "array-getter-secret" }; } });
    value.self = value;
    value.items = items;
    const date = new Date("2026-10-05T00:00:00Z");
    date.toISOString = () => { invoked++; return "Bearer date-secret"; };
    value.date = date;
    const cleaned = sanitizer.sanitizeDiagnostic(value);
    assert.equal(invoked, 0);
    assert.notEqual(typeof cleaned.fn, "function");
    assert.notEqual(typeof cleaned.toJSON, "function");
    const text = JSON.stringify(cleaned);
    assert.ok(!text.includes("secret"));
    assert.ok(text.includes("[Circular]"));
    assert.ok(text.includes("2026-10-05T00:00:00.000Z"));
    assert.equal(value.self, value);
});

test("custom JSON self returns and throwing hooks remain bounded and safe", () => {
    const self = { toJSON() { return self; } };
    assert.equal(sanitizer.sanitizeDiagnostic(self), "[Circular]");
    assert.equal(sanitizer.sanitizeDiagnostic({ toJSON() { throw new Error("Bearer thrown-secret"); } }), "[Unserializable]");
    const nested = () => ({ toJSON: nested });
    assert.equal(sanitizer.sanitizeDiagnostic(nested()), "[Depth limit]");
});

test("custom JSON keeps the serialization key and Error hook diagnostics", () => {
    const value = { nested: { toJSON(key) { return { key, Cookie: "hook-cookie" }; } } };
    assert.equal(sanitizer.sanitizeDiagnostic(value).nested.key, "nested");
    const error = new Error("safe");
    Object.defineProperty(error, "toJSON", { value() { return { safe: "error-hook", Authorization: "error-hook-auth" }; } });
    const cleaned = sanitizer.sanitizeDiagnostic(error);
    assert.equal(cleaned.safe, "error-hook");
    assert.equal(cleaned.Authorization, "[REDACTED]");
});
