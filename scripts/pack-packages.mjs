import { execFile } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = resolve(root, "artifacts");
await mkdir(artifacts, { recursive: true });

for (const entry of await readdir(resolve(root, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cwd = resolve(root, "packages", entry.name);
    const meta = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8"));
    if (meta.private) continue;
    const name = meta.name.replace(/^@/, "").replaceAll("/", "-");
    await execute(process.execPath, [resolve(root, ".yarn/releases/yarn-4.12.0.cjs"), "pack", "--out", resolve(artifacts, `${name}-${meta.version}.tgz`)], { cwd });
}
