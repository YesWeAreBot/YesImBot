import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PythonExecutor } from "../src/executors/python";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
function fixture(config: any = {}) {
    const hooks: Record<string, () => any> = {};
    const executor = new PythonExecutor(
        { logger: () => logger, yesimbot: { asset: {} }, on: (name: string, fn: () => any) => (hooks[name] = fn) } as any,
        { type: "python", enabled: true, poolSize: 0, timeout: 25, ...config },
        { maxOutputSize: 1024 } as any,
    );
    return { executor, hooks };
}
describe("Python OS sandbox", () => {
    it.each(["/", "/path/that/does/not/exist"])("rejects unsafe or missing root %s", async (sandboxRoot) => {
        const f = fixture({ sandboxRoot });
        await f.hooks.ready();
        expect((await f.executor.execute("print(42)")).status).toBe("error");
        f.hooks.dispose();
    });
    it("fails closed when the configured isolation executable is missing", async () => {
        const f = fixture({ sandboxRoot: process.cwd(), bubblewrapPath: "/does/not/exist" });
        await f.hooks.ready();
        expect(await f.executor.execute("print(42)")).toMatchObject({
            status: "error",
            error: { name: "EnvironmentError", message: expect.stringContaining("ENOENT") },
        });
        f.hooks.dispose();
    });

    it("fails closed without an explicitly configured sandbox root", async () => {
        const f = fixture();
        await f.hooks.ready();
        const result = await f.executor.execute("print(42)");
        expect(result.status).toBe("error");
        expect(result.error.message).toContain("sandboxRoot");
        await f.hooks.dispose();
    });
});

// Exercise the real bwrap argument parser even when the host prevents namespace
// creation. An empty dedicated root deliberately contains no runnable Python.
describe.skipIf(process.platform !== "linux" || !existsSync("/usr/bin/bwrap"))("real bubblewrap argument validation", () => {
    it("explicitly requests the user namespace required by disable-userns and custom IDs", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "yib-bwrap-args-"));
        const f = fixture({ sandboxRoot: root });
        try {
            await Promise.all(["proc", "dev", "tmp", "workspace"].map((name) => mkdir(path.join(root, name))));
            await f.hooks.ready();
            const result = await f.executor.execute("print(42)");
            expect(result.status).toBe("error");
            expect(result.error.message).toContain("bwrap:");
            expect(result.error.message).not.toMatch(/requires --unshare-user|Unknown option/);
        } finally {
            f.hooks.dispose();
            await rm(root, { recursive: true, force: true });
        }
    });
});

// Run with YIB_PYTHON_SANDBOX_ROOT pointing at the dedicated rootfs documented
// in README. Never substitute the host root here, even for tests.
const sandboxRoot = process.env.YIB_PYTHON_SANDBOX_ROOT;
describe.skipIf(!sandboxRoot)("real bubblewrap deployment", () => {
    it("isolates host files, environment, networking and per-request state", async () => {
        const f = fixture({ sandboxRoot, timeout: 3000 });
        await f.hooks.ready();
        try {
            const result = await f.executor.execute(`import os, socket, sys
assert 'js' not in sys.modules
assert not os.path.exists(${JSON.stringify(process.cwd())})
assert os.environ.get('YIB_HOST_SECRET') is None
try:
    socket.create_connection(('1.1.1.1', 443), timeout=0.1)
    raise AssertionError('network is reachable')
except OSError:
    pass
import builtins
builtins.private_marker = 'request-one'
print('isolated')`);
            expect(result).toMatchObject({ status: "success", result: { stdout: "isolated" } });
            expect(await f.executor.execute("import builtins\ngetattr(builtins, 'private_marker', 'clean')")).toMatchObject({
                status: "success",
                result: { stdout: "clean" },
            });
            expect(await f.executor.execute("while True:\n    pass")).toMatchObject({ status: "error", error: { name: "TimeoutError" } });
            expect(await f.executor.execute("40 + 2")).toMatchObject({ status: "success", result: { stdout: "42" } });
        } finally {
            f.hooks.dispose();
        }
    });
});
