import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const artifacts = path.join(root, "artifacts");
const tarballs = (await readdir(artifacts)).filter((name) => name.endsWith(".tgz"));
assert.ok(tarballs.length, "No packaged artifacts to verify");
const expected = [];
for (const entry of await readdir(path.join(root, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = JSON.parse(await readFile(path.join(root, "packages", entry.name, "package.json"), "utf8"));
    if (!manifest.private) expected.push(manifest.name);
}
const verified = new Set();
const temporary = await mkdtemp(path.join(tmpdir(), "yesimbot-package-smoke-"));
try {
    // Install only the published archives and their declared dependencies. Keeping
    // this outside the checkout prevents workspace dependencies masking omissions.
    execFileSync(
        "npm",
        ["install", "--prefix", temporary, "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs.map((name) => path.join(artifacts, name))],
        {
            timeout: 180_000,
            stdio: "inherit",
        },
    );
    for (const [index, filename] of tarballs.entries()) {
        const directory = path.join(temporary, String(index));
        await mkdir(directory);
        execFileSync("tar", ["-xzf", path.join(artifacts, filename), "-C", directory]);
        const packaged = path.join(directory, "package");
        const manifest = JSON.parse(await readFile(path.join(packaged, "package.json"), "utf8"));
        assert.ok(expected.includes(manifest.name), `Unexpected package: ${manifest.name}`);
        assert.ok(!verified.has(manifest.name), `Duplicate package: ${manifest.name}`);
        const targets = new Set([manifest.main, manifest.typings].filter(Boolean));
        const collect = (value) => {
            if (typeof value === "string") targets.add(value);
            else if (value && typeof value === "object") Object.values(value).forEach(collect);
        };
        collect(manifest.exports);
        for (const target of targets) {
            assert.ok(!target.includes("*"), `Unsupported wildcard export: ${target}`);
            const file = path.resolve(packaged, target);
            assert.ok(file.startsWith(packaged + path.sep), `Export leaves package: ${target}`);
            assert.ok((await stat(file)).isFile(), `Missing entry: ${target}`);
        }
        if (manifest.name === "koishi-plugin-yesimbot") {
            await access(path.join(packaged, "resources/prompts/memgpt_v2_chat.txt"));
            await access(path.join(packaged, "dist/index.js"));
            await access(path.join(packaged, "scripts/replay-decisions.cjs"));
        }
        const exportKeys = manifest.exports && typeof manifest.exports === "object" ? Object.keys(manifest.exports).filter((key) => key.startsWith(".")) : [];
        const specifiers = exportKeys.length ? exportKeys.map((key) => manifest.name + (key === "." ? "" : key.slice(1))) : [manifest.name];
        const installed = path.join(temporary, "node_modules", manifest.name);
        const probe = `
            import assert from 'node:assert/strict';
            import { createRequire } from 'node:module';
            import { pathToFileURL } from 'node:url';
            import path from 'node:path';
            const require = createRequire(pathToFileURL(path.join(process.cwd(), 'package.json')));
            for (const specifier of ${JSON.stringify(specifiers)}) {
                const imported = specifier.endsWith('/package.json')
                    ? await import(specifier, { with: { type: 'json' } })
                    : await import(specifier);
                for (const loaded of [require(specifier), imported]) {
                    if (loaded.BASE_DIR) assert.equal(loaded.BASE_DIR, ${JSON.stringify(installed)}, 'Incorrect installed resource root');
                }
            }
        `;
        execFileSync(process.execPath, ["--input-type=module", "--eval", probe], { cwd: temporary, timeout: 30_000, stdio: "inherit" });
        verified.add(manifest.name);
        console.log(`Verified packed entries: ${manifest.name}`);
    }
    assert.deepEqual([...verified].sort(), expected.sort(), "A publishable workspace has no verified artifact");
} finally {
    await rm(temporary, { recursive: true, force: true });
}
