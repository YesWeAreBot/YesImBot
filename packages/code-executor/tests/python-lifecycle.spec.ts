import { loadPyodide } from "pyodide";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withReplyTurn } from "../../core/src/agent/reply-turn";
import { AssetService } from "../../core/src/asset/service";
import { PythonExecutor } from "../src/executors/python";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
function fixture(engine: any, create: (...args: any[]) => Promise<string> = vi.fn<(...args: any[]) => Promise<string>>(async () => "asset"), timeout = 1000) {
    const hooks: Record<string, () => any> = {};
    const ctx: any = {
        baseDir: "/tmp",
        logger: () => logger,
        yesimbot: { asset: { create, capabilities: { cancellableCreate: 1 } } },
        on: (event: string, callback: () => any) => {
            hooks[event] = callback;
        },
    };
    const executor = new PythonExecutor(ctx, { enabled: true, type: "python", poolSize: 1, allowedModules: [], packages: [], timeout }, {
        maxOutputSize: 1024,
        dependenciesPath: "unused",
    } as any);
    const pool = (executor as any).pool;
    pool.createEngine = async () => engine;
    return { executor, pool, hooks, create };
}
function mockEngine(run: (globals: any) => Promise<unknown>) {
    let globals: any;
    return {
        globals: {
            set(key: string, value: any) {
                (globals ??= new Map()).set(key, value);
            },
            delete() {},
        },
        FS: { mkdirTree() {} },
        runPython(code: string) {
            if (code === "dict()")
                return {
                    set(key: string, value: any) {
                        this[key] = value;
                    },
                    destroy() {},
                };
        },
        setStdout() {},
        setStderr() {},
        runPythonAsync(_code: string, options?: any) {
            return run(options?.globals ?? Object.fromEntries(globals ?? []));
        },
    };
}
afterEach(() => vi.useRealTimers());

describe("Python request lifecycle", () => {
    it("isolates real Pyodide globals across successful and failed requests", async () => {
        const engine = await loadPyodide();
        const f = fixture(engine);
        await f.hooks.ready();
        expect((await f.executor.execute("marker = 'private'\nNone")).status).toBe("success");
        const next = await f.executor.execute("globals().get('marker', 'clean')");
        expect(next.result.stdout).toBe("clean");
        expect((await f.executor.execute("failed_marker = 'private'\nraise ValueError('expected')")).status).toBe("error");
        expect((await f.executor.execute("globals().get('failed_marker', 'clean')")).result.stdout).toBe("clean");
        await f.hooks.dispose();
    });
    it("keeps a timed-out engine occupied until its original execution settles", async () => {
        const first = deferred();
        let calls = 0;
        const f = fixture(
            mockEngine(async () => {
                if (++calls === 1) await first.promise;
                return "ok";
            }),
            undefined,
            10,
        );
        await f.hooks.ready();
        expect((await f.executor.execute("first")).error.name).toBe("TimeoutError");
        expect(f.pool.pool).toHaveLength(0);
        const second = f.executor.execute("second");
        await Promise.resolve();
        expect(calls).toBe(1);
        first.resolve();
        expect((await second).status).toBe("success");
        expect(calls).toBe(2);
        await f.hooks.dispose();
    });
    it("disposal releases both a running caller and a caller waiting for an engine", async () => {
        const first = deferred();
        const entered = deferred();
        const f = fixture(
            mockEngine(async () => {
                entered.resolve();
                await first.promise;
            }),
        );
        await f.hooks.ready();
        const running = f.executor.execute("first");
        await entered.promise;
        const waiting = f.executor.execute("second");
        await f.hooks.dispose();
        const settled = await Promise.race([Promise.all([running, waiting]), new Promise<null>((r) => setTimeout(() => r(null), 25))]);
        first.resolve();
        expect(settled).not.toBeNull();
        expect(settled?.map((x) => x.status)).toEqual(["error", "error"]);
        await Promise.resolve();
        expect(f.pool.pool).toHaveLength(0);
    });
    it("waits for an asynchronous artifact write before returning success", async () => {
        const engine = await loadPyodide();
        const write = deferred<string>();
        const entered = deferred();
        const f = fixture(
            engine,
            vi.fn<(...args: any[]) => Promise<string>>(async () => {
                entered.resolve();
                return write.promise;
            }),
        );
        await f.hooks.ready();
        let settled = false;
        const output = f.executor.execute("__create_artifact__('hello.txt', 'hello')\nNone").then((x) => {
            settled = true;
            return x;
        });
        await entered.promise;
        await new Promise((r) => setTimeout(r, 10));
        expect(settled).toBe(false);
        write.resolve("asset");
        expect((await output).result.artifacts).toEqual([{ assetId: "asset", fileName: "hello.txt" }]);
        await f.hooks.dispose();
    });
    it("reports an artifact write failure instead of a successful empty receipt", async () => {
        const engine = await loadPyodide();
        const f = fixture(
            engine,
            vi.fn<(...args: any[]) => Promise<string>>(async () => {
                throw new Error("storage failed");
            }),
        );
        await f.hooks.ready();
        const output = await f.executor.execute("__create_artifact__('hello.txt', 'hello')\nNone");
        expect(output.status).toBe("error");
        expect(output.error.message).toContain("storage failed");
        await f.hooks.dispose();
    });
    it.each(["cancel", "dispose"])("does not persist a staged artifact after %s", async (action) => {
        const blocked = deferred();
        const entered = deferred();
        const f = fixture(
            mockEngine(async (globals) => {
                await globals.__create_artifact__("hello.txt", "hello");
                entered.resolve();
                await blocked.promise;
            }),
        );
        await f.hooks.ready();
        const turn = new AbortController();
        const output = withReplyTurn(
            () => true,
            () => f.executor.execute("artifact"),
            turn.signal,
        );
        await entered.promise;
        if (action === "cancel") turn.abort();
        else await f.hooks.dispose();
        blocked.resolve();
        expect((await output).status).toBe("error");
        expect(f.create).not.toHaveBeenCalled();
        await f.hooks.dispose();
    });
    it("removes a cancelled engine waiter without affecting the running request", async () => {
        const blocked = deferred(),
            entered = deferred();
        let calls = 0;
        const f = fixture(
            mockEngine(async () => {
                if (++calls === 1) {
                    entered.resolve();
                    await blocked.promise;
                }
                return "ok";
            }),
        );
        await f.hooks.ready();
        const running = f.executor.execute("first");
        await entered.promise;
        const turn = new AbortController();
        const waiting = withReplyTurn(
            () => true,
            () => f.executor.execute("waiting"),
            turn.signal,
        );
        expect(f.pool.waiting).toHaveLength(1);
        turn.abort();
        expect((await waiting).status).toBe("error");
        expect(f.pool.waiting).toHaveLength(0);
        blocked.resolve();
        expect((await running).status).toBe("success");
        expect((await f.executor.execute("healthy")).status).toBe("success");
        expect(calls).toBe(2);
        await f.hooks.dispose();
    });
    it.each(["cancel", "dispose"])("rolls back a real AssetService write in progress during %s", async (action) => {
        const entered = deferred(),
            blocked = deferred(),
            rolledBack = deferred();
        const files = new Map<string, Buffer>(),
            rows = new Map<string, any>();
        const asset = Object.create(AssetService.prototype);
        Object.assign(asset, {
            logger,
            _getSourceBuffer: async (data: Buffer) => ({ data, type: "text/plain" }),
            storage: {
                write: async (id: string, data: Buffer) => {
                    files.set(id, data);
                },
                delete: async (id: string) => {
                    files.delete(id);
                    rolledBack.resolve();
                },
            },
            ctx: {
                database: {
                    get: async () => [],
                    upsert: async (_table: any, data: any[]) => {
                        for (const row of data) rows.set(row.id, row);
                        entered.resolve();
                        await blocked.promise;
                    },
                    remove: async (_table: any, query: any) => {
                        rows.delete(query.id);
                    },
                },
            },
        });
        const f = fixture(
            mockEngine(async (globals) => {
                await globals.__create_artifact__("hello.txt", "hello");
            }),
            asset.create.bind(asset),
        );
        await f.hooks.ready();
        const turn = new AbortController();
        const output = withReplyTurn(
            () => true,
            () => f.executor.execute("artifact"),
            turn.signal,
        );
        await entered.promise;
        if (action === "cancel") turn.abort();
        else await f.hooks.dispose();
        expect((await output).status).toBe("error");
        blocked.resolve();
        await rolledBack.promise;
        expect(files.size).toBe(0);
        expect(rows.size).toBe(0);
        await f.hooks.dispose();
    });
    it.each([false, true])("runs the generated matplotlib script with figures=%s", async (figures) => {
        const engine = await loadPyodide();
        // Use real Python syntax/execution and BytesIO, with only plotting stubbed
        // so this regression test never downloads external Python packages.
        engine.runPython(`
import sys, types
matplotlib = types.ModuleType('matplotlib')
matplotlib.use = lambda _: None
pyplot = types.ModuleType('matplotlib.pyplot')
pyplot.get_fignums = lambda: ${figures ? "[1]" : "[]"}
pyplot.figure = lambda _: None
pyplot.savefig = lambda buf, **kwargs: buf.write(b'png')
pyplot.close = lambda _: None
matplotlib.pyplot = pyplot
sys.modules['matplotlib'] = matplotlib
sys.modules['matplotlib.pyplot'] = pyplot
`);
        const f = fixture(engine);
        await f.hooks.ready();
        const output = await f.executor.execute("import matplotlib.pyplot as plt\nprint('plot')");
        expect(output.error).toBeUndefined();
        expect(output.status).toBe("success");
        expect(output.result.stdout).toBe("plot");
        expect(output.result.artifacts).toHaveLength(figures ? 1 : 0);
        const written = vi
            .mocked(f.create)
            .mock.calls.map(([data, metadata, options]) => [data.toString(), metadata.filename, options.signal instanceof AbortSignal]);
        expect(written).toEqual(figures ? [["png", "chart_1.png", true]] : []);
        await f.hooks.dispose();
    });
    it("preserves the main-module name in each isolated real Python script", async () => {
        const engine = await loadPyodide();
        const f = fixture(engine);
        await f.hooks.ready();
        const output = await f.executor.execute("if __name__ == '__main__':\n    print('main')\nclass Example:\n    pass\nprint(Example.__module__)");
        expect(output.result.stdout).toBe("main\n__main__");
        await f.hooks.dispose();
    });
    it("rejects artifacts on an older core before calling its uncancellable asset create", async () => {
        const f = fixture(
            mockEngine(async (globals) => {
                await globals.__create_artifact__("hello.txt", "hello");
            }),
        );
        delete (f.executor as any).assetService.capabilities;
        await f.hooks.ready();
        const output = await f.executor.execute("artifact");
        expect(output.status).toBe("error");
        expect(output.error.message).toContain("update YesImBot core");
        expect(f.create).not.toHaveBeenCalled();
        await f.hooks.dispose();
    });
    it("keeps calculations without artifacts available on an older core", async () => {
        const f = fixture(mockEngine(async () => 42));
        delete (f.executor as any).assetService.capabilities;
        await f.hooks.ready();
        const output = await f.executor.execute("calculation");
        expect(output.status).toBe("success");
        expect(output.result.stdout).toBe("42");
        expect(f.create).not.toHaveBeenCalled();
        await f.hooks.dispose();
    });
});
