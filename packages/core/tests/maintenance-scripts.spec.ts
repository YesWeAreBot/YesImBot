import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expect, it, onTestFinished } from "vitest";

const scripts = fileURLToPath(new URL("../../../scripts/", import.meta.url));
async function fixture(script: string) {
    const root = await mkdtemp(path.join(tmpdir(), "yib-script-audit-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, "scripts"));
    await mkdir(path.join(root, "packages", "example"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
    await copyFile(path.join(scripts, script), path.join(root, "scripts", script));
    return { root, entry: path.join(root, "scripts", script), pkg: path.join(root, "packages", "example") };
}

it("runs the retained canary utility as an ESM CLI against only temporary manifests", async () => {
    const f = await fixture("optimize-canary-version.js");
    const sha = "abcdef0123456789abcdef0123456789abcdef01";
    await writeFile(
        path.join(f.pkg, "package.json"),
        JSON.stringify({
            name: "example",
            version: `1.0.0-canary.${sha}`,
            dependencies: { current: "^1.0.0", candidate: `2.0.0-canary.${sha}` },
        }),
    );
    await writeFile(path.join(f.pkg, "CHANGELOG.md"), `# 1.0.0-canary.${sha}\nNotes\n`);
    const run = spawnSync(process.execPath, [f.entry], { cwd: f.root, encoding: "utf8", timeout: 10_000 });
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(0);
    const manifest = JSON.parse(await readFile(path.join(f.pkg, "package.json"), "utf8"));
    expect(manifest.version).toBe("1.0.0-canary.abcdef0");
    expect(manifest.dependencies).toEqual({ current: "^1.0.0", candidate: "2.0.0-canary.abcdef0" });
    expect(await readFile(path.join(f.pkg, "CHANGELOG.md"), "utf8")).toBe("# 1.0.0-canary.abcdef0\nNotes\n");
});

it("runs mirror dry-run offline and keeps its ESM import free of CLI side effects", async () => {
    const f = await fixture("sync-npmmirror.js");
    const manifest = JSON.stringify({ name: "@example/package", version: "1.0.0" });
    await writeFile(path.join(f.pkg, "package.json"), manifest);
    const block = path.join(f.root, "offline.mjs");
    await writeFile(block, 'globalThis.fetch = () => { throw new Error("Unexpected network request"); };\n');
    const run = spawnSync(process.execPath, ["--import", block, f.entry, "--dry-run"], { cwd: f.root, encoding: "utf8", timeout: 10_000 });
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("@example/package (测试模式)");
    expect(run.stdout).not.toContain("同步失败");
    expect(run.stdout).not.toContain("同步错误");
    expect(await readFile(path.join(f.pkg, "package.json"), "utf8")).toBe(manifest);
    const imported = execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", `const m = await import(${JSON.stringify(pathToFileURL(f.entry).href)}); console.log(typeof m.main);`],
        { cwd: f.root, encoding: "utf8", timeout: 10_000 },
    );
    expect(imported.trim()).toBe("function");
});
