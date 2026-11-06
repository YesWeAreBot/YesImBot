import { realpath, stat } from "node:fs/promises";

import { Context, Logger, Schema } from "koishi";
import { AssetService, replyTurnSignal, ToolDefinition, withInnerThoughts } from "koishi-plugin-yesimbot";

import { SharedConfig } from "../../config";
import { CodeExecutionResult, CodeExecutor } from "../base";
import { runProcess } from "./process";
import { PYTHON_RUNNER } from "./runner";

export interface PythonConfig {
    type: "python";
    enabled: boolean;
    timeout?: number;
    poolSize?: number;
    sandboxRoot?: string;
    bubblewrapPath?: string;
    pythonPath?: string;
    memoryLimitMiB?: number;
    customToolDescription?: string;
}
export const PythonConfigSchema: Schema<PythonConfig> = Schema.object({
    type: Schema.const("python").hidden(),
    enabled: Schema.boolean().default(false),
    timeout: Schema.number().min(1).max(300000).default(30000).description("单次执行超时（毫秒，含排队和产物写入）"),
    poolSize: Schema.number().min(1).max(10).default(2).description("最多同时运行的独立沙箱数"),
    sandboxRoot: Schema.string().description("管理员准备的独立只读 Linux 根文件系统；禁止填写主机根目录"),
    bubblewrapPath: Schema.string().default("/usr/bin/bwrap").description("宿主 bubblewrap 绝对路径"),
    pythonPath: Schema.string().default("/usr/bin/python3").description("沙箱内 CPython 绝对路径"),
    memoryLimitMiB: Schema.number().min(64).max(4096).default(512).description("每进程虚拟内存上限（MiB）"),
    customToolDescription: Schema.string().role("textarea"),
}) as Schema<PythonConfig>;

export class PythonExecutor implements CodeExecutor {
    readonly type = "python";
    private readonly logger: Logger;
    private readonly assetService: AssetService;
    private readonly shutdown = new AbortController();
    private root = "";
    private initializationError = "Python sandbox has not initialized";
    private isReady = false;
    private active = 0;
    private waiting: Array<() => void> = [];
    constructor(
        private ctx: Context,
        private config: PythonConfig,
        private sharedConfig: SharedConfig,
    ) {
        this.logger = ctx.logger("[执行器:Python]");
        this.assetService = ctx.yesimbot.asset;
        ctx.on("ready", async () => {
            if (!config.enabled || this.shutdown.signal.aborted) return;
            try {
                if (process.platform !== "linux") throw new Error("Python sandbox requires Linux and bubblewrap");
                if (!config.sandboxRoot) throw new Error("Configure sandboxRoot with a dedicated Python root filesystem; host execution is disabled");
                this.root = await realpath(config.sandboxRoot);
                if (this.root === "/" || !(await stat(this.root)).isDirectory())
                    throw new Error("sandboxRoot must be a dedicated directory, never the host root");
                const command = config.bubblewrapPath ?? "/usr/bin/bwrap";
                if (!command.startsWith("/") || !(config.pythonPath ?? "/usr/bin/python3").startsWith("/"))
                    throw new Error("Sandbox executable paths must be absolute");
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(new Error("Python sandbox startup timed out")), 5000);
                try {
                    const signal = AbortSignal.any([controller.signal, this.shutdown.signal]);
                    const probe = await this.run(
                        'import os; assert os.getuid() == 65534; open("/workspace/probe", "w").close(); open("/tmp/probe", "w").close(); print("sandbox-ready")',
                        signal,
                    );
                    if (probe.stdout !== "sandbox-ready") throw new Error("Python sandbox startup probe failed");
                } finally {
                    clearTimeout(timer);
                }
                this.isReady = !this.shutdown.signal.aborted;
            } catch (error) {
                this.initializationError = error instanceof Error ? error.message : String(error);
                this.logger.error("Python sandbox unavailable: %s", this.initializationError);
            }
        });
        ctx.on("dispose", () => {
            this.isReady = false;
            this.shutdown.abort(new Error("Python executor stopped"));
        });
    }
    private async acquire(signal: AbortSignal): Promise<() => void> {
        signal.throwIfAborted();
        const capacity = Math.min(10, Math.max(1, this.config.poolSize ?? 2));
        if (this.active >= capacity)
            await new Promise<void>((resolve, reject) => {
                const wake = () => {
                    signal.removeEventListener("abort", abort);
                    resolve();
                };
                const abort = () => {
                    this.waiting = this.waiting.filter((item) => item !== wake);
                    reject(signal.reason);
                };
                this.waiting.push(wake);
                signal.addEventListener("abort", abort, { once: true });
                if (signal.aborted) abort();
            });
        // A wake transfers an existing lease rather than opening a race for it.
        else this.active++;
        if (signal.aborted) {
            this.release();
            signal.throwIfAborted();
        }
        return () => this.release();
    }
    private release() {
        const next = this.waiting.shift();
        if (next) next();
        else this.active--;
    }
    private async run(code: string, signal: AbortSignal): Promise<any> {
        const args = [
            "--unshare-all",
            // --unshare-all only requests userns on a best-effort basis.
            // --disable-userns and custom IDs require an explicit userns.
            "--unshare-user",
            "--disable-userns",
            "--die-with-parent",
            "--new-session",
            "--cap-drop",
            "ALL",
            "--uid",
            "65534",
            "--gid",
            "65534",
            "--ro-bind",
            this.root,
            "/",
            "--proc",
            "/proc",
            "--dev",
            "/dev",
            "--perms",
            "1777",
            "--size",
            "67108864",
            "--tmpfs",
            "/tmp",
            "--perms",
            "1777",
            "--size",
            "67108864",
            "--tmpfs",
            "/workspace",
            "--chdir",
            "/workspace",
            "--clearenv",
            "--setenv",
            "PATH",
            "/usr/bin:/bin",
            "--setenv",
            "HOME",
            "/workspace",
            "--setenv",
            "MPLCONFIGDIR",
            "/workspace/.matplotlib",
            "--",
            this.config.pythonPath ?? "/usr/bin/python3",
            "-I",
            "-c",
            PYTHON_RUNNER,
        ];
        const input = JSON.stringify({
            code,
            limit: Math.min(1048576, Math.max(0, this.sharedConfig.maxOutputSize ?? 10240)),
            memory: Math.min(4096, Math.max(64, this.config.memoryLimitMiB ?? 512)) * 1024 * 1024,
        });
        const response = JSON.parse(await runProcess(this.config.bubblewrapPath ?? "/usr/bin/bwrap", args, input, signal));
        if (response.error)
            throw Object.assign(new Error(String(response.error.message)), { name: String(response.error.name), stack: String(response.error.stack) });
        if (typeof response.stdout !== "string" || typeof response.stderr !== "string" || !Array.isArray(response.artifacts))
            throw new Error("Invalid Python sandbox response");
        const limit = Math.min(1048576, Math.max(0, this.sharedConfig.maxOutputSize ?? 10240));
        for (const stream of ["stdout", "stderr"]) {
            const points = Array.from(response[stream] as string);
            if (points.length > limit && !response[stream].endsWith(`\n[Output truncated after ${limit} characters]`))
                response[stream] = points.slice(0, limit).join("") + `\n[Output truncated after ${limit} characters]`;
        }
        if (response.artifacts.length > 16) throw new Error("Sandbox artifact count exceeds 16");
        let artifactBytes = 0;
        for (const artifact of response.artifacts) {
            if (typeof artifact.content !== "string" || (artifactBytes += Buffer.byteLength(artifact.content, "base64")) > 16777216)
                throw new Error("Sandbox artifact data exceeds 16 MiB");
        }
        return response;
    }
    getToolDefinition(): ToolDefinition {
        return {
            name: "execute_python",
            description:
                this.config.customToolDescription ||
                `Executes Python in a fresh Linux OS sandbox without network access. Installed libraries depend on the administrator-provided root filesystem. Use print() or a final expression for output. Files in /workspace are temporary. Use __create_artifact__(fileName, text_or_bytes, type=None) to return files. Matplotlib figures are returned automatically.`,
            parameters: withInnerThoughts({ code: Schema.string().required().description("The Python code to execute.") }),
            execute: async ({ code }) => this.execute(code),
        };
    }
    async execute(code: string): Promise<CodeExecutionResult> {
        if (!this.isReady) return { status: "error", error: { name: "EnvironmentError", message: this.initializationError } };
        const deadline = new AbortController();
        const turn = replyTurnSignal();
        const signal = AbortSignal.any([this.shutdown.signal, deadline.signal, ...(turn ? [turn] : [])]);
        const timer = setTimeout(
            () =>
                deadline.abort(
                    Object.assign(new Error(`Code execution exceeded the time limit of ${this.config.timeout ?? 30000}ms.`), { name: "TimeoutError" }),
                ),
            Math.min(300000, Math.max(1, this.config.timeout ?? 30000)),
        );
        let release: (() => void) | undefined;
        let abort: (() => void) | undefined;
        const operation = (async (): Promise<CodeExecutionResult> => {
            release = await this.acquire(signal);
            try {
                const output = await this.run(code, signal);
                signal.throwIfAborted();
                if (output.artifacts.length && this.assetService.capabilities?.cancellableCreate !== 1)
                    throw new Error("Please update YesImBot core: cancellable asset creation is unavailable.");
                const artifacts = [];
                for (const artifact of output.artifacts) {
                    signal.throwIfAborted();
                    if (
                        typeof artifact.fileName !== "string" ||
                        !artifact.fileName ||
                        artifact.fileName.length > 255 ||
                        /[/\\]/.test(artifact.fileName) ||
                        typeof artifact.content !== "string"
                    )
                        throw new Error("Invalid sandbox artifact");
                    const assetId = await this.assetService.create(Buffer.from(artifact.content, "base64"), { filename: artifact.fileName }, { signal });
                    signal.throwIfAborted();
                    artifacts.push({ assetId, fileName: artifact.fileName });
                }
                return { status: "success", result: { stdout: output.stdout, stderr: output.stderr, artifacts } };
            } finally {
                release?.();
            }
        })();
        try {
            return await Promise.race([
                operation,
                new Promise<never>((_, reject) => {
                    abort = () => reject(signal.reason);
                    signal.addEventListener("abort", abort, { once: true });
                    if (signal.aborted) abort();
                }),
            ]);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            return { status: "error", error: { name: err.name, message: err.message, stack: err.stack } };
        } finally {
            clearTimeout(timer);
            if (abort) signal.removeEventListener("abort", abort);
        }
    }
}
