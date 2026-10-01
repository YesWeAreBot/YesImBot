import { describe, expect, it, mock } from "bun:test";
import { createRequire } from "node:module";

// The workspace's core build supplies CommonJS entries; use those real exports
// when its optional ESM entries have not been generated.
const require = createRequire(import.meta.url);
const services = require("koishi-plugin-yesimbot/services");
const shared = require("koishi-plugin-yesimbot/shared");
mock.module("koishi-plugin-yesimbot/services", () => services);
mock.module("koishi-plugin-yesimbot/shared", () => shared);
const { PythonExecutor } = await import("../src/executors/python");

function executorFixture(options: { limit: number; stdout?: string[]; stderr?: string[]; result?: unknown; error?: Error }) {
    const logger = { debug() {}, info() {}, warn() {}, error() {} };
    let writeStdout: (message: string) => void;
    let writeStderr: (message: string) => void;
    let released = false;
    const engine = {
        globals: { set() {}, delete() {} },
        FS: { mkdirTree() {} },
        runPython() {},
        setStdout({ batched }: { batched: (message: string) => void }) {
            writeStdout = batched;
        },
        setStderr({ batched }: { batched: (message: string) => void }) {
            writeStderr = batched;
        },
        async runPythonAsync() {
            for (const message of options.stdout || []) writeStdout(message);
            for (const message of options.stderr || []) writeStderr(message);
            if (options.error) throw options.error;
            return options.result;
        },
    };
    // Only the external Pyodide engine is simulated; execute(), collection,
    // result conversion, error handling, and cleanup use the production class.
    const executor = Object.create(PythonExecutor.prototype);
    Object.assign(executor, {
        isReady: true,
        ctx: { logger },
        logger,
        config: { allowedModules: [], timeout: 50 },
        sharedConfig: { maxOutputSize: options.limit },
        pool: {
            async acquire() {
                return engine;
            },
            release() {
                released = true;
            },
        },
    });
    return { executor, released: () => released };
}

describe("Python output character limits", () => {
    it("bounds each output stream across multiple chunks and the final expression", async () => {
        const { executor } = executorFixture({
            limit: 6,
            stdout: ["abc", "def", "discarded"],
            stderr: ["uvwxyz", "discarded"],
            result: "discarded final value",
        });
        const output = await executor.execute("print('test')");
        expect(output.status).toBe("success");
        expect(output.result.stdout).toStartWith("abc\nde\n[");
        expect(output.result.stderr).toStartWith("uvwxyz\n[");
        expect(output.result.stdout).toContain("truncated");
        expect(output.result.stderr).toContain("truncated");
        expect(output.result.stdout).not.toContain("discarded");
        expect(output.result.stderr).not.toContain("discarded");
    });

    it("bounds a final expression even when the engine prints nothing", async () => {
        const { executor } = executorFixture({ limit: 4, result: "0123456789" });
        const output = await executor.execute("'result'");
        expect(output.result.stdout).toStartWith("0123\n[");
        expect(output.result.stdout).toContain("truncated");
        expect(output.result.stderr).toBe("");
    });

    it("counts Unicode characters rather than UTF-8 bytes and keeps surrogate pairs intact", async () => {
        const { executor } = executorFixture({ limit: 3, stdout: ["A😀B界"] });
        const output = await executor.execute("print('unicode')");
        expect(output.result.stdout).toStartWith("A😀B\n[");
        expect(output.result.stdout).not.toContain("界");
    });

    it("preserves short output, empty chunk handling, and final result conversion", async () => {
        const { executor } = executorFixture({ limit: 40, stdout: ["", "abc", "def"], stderr: ["", "warning"], result: 123 });
        const output = await executor.execute("print('short')");
        expect(output.result.stdout).toBe("abc\ndef\n123");
        expect(output.result.stderr).toBe("\nwarning");
    });

    it("does not mark output that fits the limit exactly as truncated", async () => {
        const { executor } = executorFixture({ limit: 3, stdout: ["abc", ""], result: "" });
        const output = await executor.execute("print('exact')");
        expect(output.result.stdout).toBe("abc");
    });

    it("preserves execution errors and releases the engine after excess output", async () => {
        const { executor, released } = executorFixture({ limit: 3, stdout: ["too much output"], error: new Error("engine failed") });
        const output = await executor.execute("print('failure')");
        expect(output.status).toBe("error");
        expect(output.error.name).toBe("Error");
        expect(output.error.message).toBe("engine failed");
        expect(released()).toBe(true);
    });
});
