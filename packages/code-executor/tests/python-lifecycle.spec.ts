import { withReplyTurn } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";

import { PythonExecutor } from "../src/executors/python";
import { python } from "./python-fixture";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
function fixture(timeout = 3000, create = vi.fn<(...args: any[]) => Promise<string>>(async () => "asset")) {
    const hooks: Record<string, () => any> = {};
    const executor = new PythonExecutor(
        {
            logger: () => logger,
            yesimbot: { asset: { create, capabilities: { cancellableCreate: 1 } } },
            on: (name: string, fn: () => any) => (hooks[name] = fn),
        } as any,
        { type: "python", enabled: true, poolSize: 1, timeout },
        { maxOutputSize: 1024 } as any,
    );
    // Lifecycle and process termination are tested independently of the OS sandbox,
    // whose real deployment contract is covered by python-sandbox.spec.ts.
    Object.assign(executor, { isReady: true, run: (code: string, signal: AbortSignal) => python(code, 1024, signal) });
    return { executor, hooks, create };
}
describe("Python request lifecycle", () => {
    it("externally terminates CPU-bound Python without blocking the JS event loop", async () => {
        const f = fixture(100);
        let ticked = false;
        const timer = setTimeout(() => (ticked = true), 10);
        const start = Date.now();
        const result = await f.executor.execute("while True:\n    pass");
        clearTimeout(timer);
        expect(ticked).toBe(true);
        expect(result.error.name).toBe("TimeoutError");
        expect(Date.now() - start).toBeLessThan(1500);
        // Give interpreter startup a normal budget when checking recovery under CI load.
        (f.executor as any).config.timeout = 3000;
        expect(await f.executor.execute("40 + 2")).toMatchObject({ status: "success", result: { stdout: "42" } });
        f.hooks.dispose();
    });
    it("creates fresh builtins and module state for every request", async () => {
        const f = fixture();
        expect((await f.executor.execute("import builtins\nbuiltins.private_marker = 42")).status).toBe("success");
        expect((await f.executor.execute("import builtins\ngetattr(builtins, 'private_marker', 'clean')")).result.stdout).toBe("clean");
        expect((await f.executor.execute("import builtins\nbuiltins.failure_marker = 42\nraise ValueError('expected')")).status).toBe("error");
        expect((await f.executor.execute("import builtins\ngetattr(builtins, 'failure_marker', 'clean')")).result.stdout).toBe("clean");
        f.hooks.dispose();
    });
    it.each(["cancel", "dispose"])("terminates active and queued calls on %s", async (action) => {
        const f = fixture();
        const turn = new AbortController();
        const run = () =>
            withReplyTurn(
                () => true,
                () => f.executor.execute("while True:\n    pass"),
                turn.signal,
            );
        const first = run(),
            second = run();
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (action === "cancel") turn.abort();
        else f.hooks.dispose();
        expect((await Promise.all([first, second])).map((result) => result.status)).toEqual(["error", "error"]);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect((f.executor as any).active).toBe(0);
        expect((f.executor as any).waiting).toHaveLength(0);
        f.hooks.dispose();
    });
    it("awaits artifact persistence and reports storage errors", async () => {
        const create = vi.fn<(...args: any[]) => Promise<string>>(async () => {
            throw new Error("storage failed");
        });
        const f = fixture(3000, create);
        const result = await f.executor.execute("__create_artifact__('hello.txt', 'hello')");
        expect(result.error.message).toContain("storage failed");
        expect(create).toHaveBeenCalledOnce();
        expect(create.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
        f.hooks.dispose();
    });
    it("does not persist staged files from a cancelled execution", async () => {
        const f = fixture(100);
        const result = await f.executor.execute("__create_artifact__('hello.txt', 'hello')\nwhile True:\n    pass");
        expect(result.error.name).toBe("TimeoutError");
        expect(f.create).not.toHaveBeenCalled();
        f.hooks.dispose();
    });
    it("cancels a pending asset write with the turn signal", async () => {
        let entered!: () => void;
        const started = new Promise<void>((resolve) => (entered = resolve));
        const create = vi.fn<(...args: any[]) => Promise<string>>(
            (_data: any, _meta: any, options: any) =>
                new Promise<string>((_resolve, reject) => {
                    entered();
                    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
                }),
        );
        const f = fixture(3000, create as any);
        const controller = new AbortController();
        const running = withReplyTurn(
            () => true,
            () => f.executor.execute("__create_artifact__('hello.txt', 'hello')"),
            controller.signal,
        );
        await started;
        controller.abort();
        expect((await running).status).toBe("error");
        f.hooks.dispose();
    });
});
