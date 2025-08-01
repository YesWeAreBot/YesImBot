import { Context, Logger, Schema } from "koishi";
import { AssetService, AssetType, ToolDefinition, withInnerThoughts } from "koishi-plugin-yesimbot/services";
import { Services } from "koishi-plugin-yesimbot/shared";
import path from "path";
import { loadPyodide, PyodideInterface } from "pyodide";
import type { PyProxy } from "pyodide/ffi";
import { SharedConfig } from "../../config";
import { CodeExecutionResult, CodeExecutor, ExecutionArtifact, ExecutionError } from "../base";

// --- 新增：用于管理引擎实例的池 ---
class PyodideEnginePool {
    private readonly logger: Logger;
    private pool: PyodideInterface[] = [];
    private waiting: ((engine: PyodideInterface) => void)[] = [];
    private readonly maxSize: number;
    private readonly pyodideLoader: Promise<PyodideInterface>;
    private isInitialized = false;

    constructor(private ctx: Context, private config: PythonConfig, private sharedConfig: SharedConfig) {
        this.logger = ctx.logger(`[executor:python:pool]`);
        this.maxSize = config.poolSize;
        this.pyodideLoader = this.createEngine();
    }

    private async createEngine(): Promise<PyodideInterface> {
        this.logger.info(`Creating new Pyodide engine instance...`);

        const pyodide = await loadPyodide({
            packageCacheDir: path.join(this.sharedConfig.dependenciesPath, "pyodide"),
        });

        if (this.config.packages && this.config.packages.length > 0) {
            this.logger.info(`Loading base packages: ${this.config.packages.join(", ")}`);
            await pyodide.loadPackage(this.config.packages);
        }
        this.logger.info("New Pyodide engine instance created and configured.");
        return pyodide;
    }

    public async initialize(): Promise<void> {
        if (this.isInitialized) return;
        this.logger.info(`Initializing engine pool with size ${this.maxSize}...`);
        try {
            const initialEngine = await this.pyodideLoader;
            this.pool.push(initialEngine);
            // 并行创建其他实例
            const promises = Array.from({ length: this.maxSize - 1 }, () => this.createEngine());
            const otherEngines = await Promise.all(promises);
            this.pool.push(...otherEngines);
            this.isInitialized = true;
            this.logger.info(`Engine pool initialized successfully with ${this.pool.length} instances.`);
        } catch (error) {
            this.logger.error("Failed to initialize Pyodide engine pool:", error);
            this.isInitialized = false;
            throw error;
        }
    }

    public async acquire(): Promise<PyodideInterface> {
        if (!this.isInitialized) {
            throw new Error("Pyodide pool is not initialized or failed to initialize.");
        }
        if (this.pool.length > 0) {
            this.logger.debug(`Acquiring engine from pool. Available: ${this.pool.length - 1}`);
            return this.pool.pop()!;
        }
        this.logger.debug("No available engine in pool, waiting...");
        return new Promise<PyodideInterface>((resolve) => {
            this.waiting.push(resolve);
        });
    }

    public release(engine: PyodideInterface): void {
        if (this.waiting.length > 0) {
            this.logger.debug("Releasing engine to a waiting consumer.");
            const next = this.waiting.shift()!;
            next(engine);
        } else {
            this.logger.debug(`Releasing engine back to pool. Available: ${this.pool.length + 1}`);
            this.pool.push(engine);
        }
    }
}

export interface PythonConfig {
    type: "python";
    enabled: boolean;
    timeout?: number;
    poolSize?: number;
    allowedModules?: string[];
    packages?: string[];
    customToolDescription?: string;
}

export const PythonConfigSchema: Schema<PythonConfig> = Schema.intersect([
    Schema.object({
        type: Schema.const("python").hidden().description("引擎类型"),
        enabled: Schema.boolean().default(false).description("是否启用此引擎"),
    }).description("Python 执行引擎"),
    Schema.union([
        Schema.object({
            enabled: Schema.const(true).required(),
            timeout: Schema.number().default(30000).description("代码执行的超时时间（毫秒）"),
            poolSize: Schema.number().default(2).min(1).max(10).description("Pyodide 引擎池的大小，用于并发执行"),
            allowedModules: Schema.array(String)
                .default(["matplotlib", "numpy", "pandas", "sklearn", "scipy", "requests"])
                .role("table")
                .description("允许代码通过 import 导入的模块白名单"),
            packages: Schema.array(String)
                .default(["numpy", "pandas", "matplotlib", "scikit-learn"])
                .role("table")
                .description("预加载到每个 Pyodide 实例中的 Python 包"),
            customToolDescription: Schema.string()
                .role("textarea", { rows: [2, 4] })
                .description("自定义工具描述，留空则使用默认描述"),
        }),
        Schema.object({}),
    ]),
]) as Schema<PythonConfig>;

// --- 重构后的 PythonExecutor ---
export class PythonExecutor implements CodeExecutor {
    readonly type = "python";
    private readonly logger: Logger;
    private readonly pool: PyodideEnginePool;
    // 假设你有一个资源管理器服务
    private readonly assetService: AssetService;
    private isReady = false;

    constructor(private ctx: Context, private config: PythonConfig, private sharedConfig: SharedConfig) {
        this.logger = ctx.logger(`[executor:${this.type}]`);
        this.assetService = ctx[Services.Asset];
        this.pool = new PyodideEnginePool(ctx, config, sharedConfig);

        ctx.on("ready", async () => {
            if (config.enabled) {
                try {
                    await this.pool.initialize();
                    this.isReady = true;
                    this.logger.info("Python executor is ready.");
                } catch (error) {
                    this.logger.error("Python executor failed to start.", error);
                }
            }
        });
    }

    private _checkCodeSecurity(code: string): void {
        const forbiddenImports = ["os", "subprocess", "sys", "shutil", "socket", "http.server", "ftplib"];
        const userAllowed = new Set(this.config.allowedModules);

        const importRegex = /^\s*from\s+([\w.]+)\s+import|^\s*import\s+([\w.]+)/gm;
        let match;
        while ((match = importRegex.exec(code)) !== null) {
            const moduleName = (match[1] || match[2]).split(".")[0];
            if (forbiddenImports.includes(moduleName) && !userAllowed.has(moduleName)) {
                throw new Error(`SecurityError: Importing the module '${moduleName}' is not allowed.`);
            }
            if (!userAllowed.has(moduleName)) {
                // 如果需要严格白名单，取消此注释
                // throw new Error(`SecurityError: Module '${moduleName}' is not in the list of allowed modules.`);
            }
        }

        // 简化的文件访问检查，更严格的控制在 Pyodide 的虚拟环境中完成
        if (code.includes("open(") && !code.includes("/workspace/")) {
            this.logger.warn(`Potential file access outside of /workspace. Code: ${code}`);
        }
    }

    private async _resetEngineState(engine: PyodideInterface): Promise<void> {
        // 清理全局变量，除了Pyodide默认的
        engine.runPython(`
            import sys
            # 存储初始的全局变量名
            if 'initial_globals' not in globals():
                initial_globals = set(globals().keys())

            # 删除非初始的全局变量
            for name in list(globals().keys()):
                if name not in initial_globals:
                    del globals()[name]

            # 重置 matplotlib 状态
            try:
                import matplotlib.pyplot as plt
                plt.close('all')
            except ImportError:
                pass

            # 清理工作区文件
            import os
            workspace = '/workspace'
            if os.path.exists(workspace):
                for item in os.listdir(workspace):
                    item_path = os.path.join(workspace, item)
                    if os.path.isfile(item_path):
                        os.remove(item_path)
        `);
    }

    private _parsePyodideError(error: any): ExecutionError {
        const err = error as Error;
        const isTimeout = err.message.includes("TimeoutError");
        let suggestion = "There might be a logical error in the code. Please review the logic and try again.";

        if (isTimeout) {
            return {
                name: "TimeoutError",
                message: `Code execution exceeded the time limit of ${this.config.timeout}ms.`,
                stack: err.stack,
                suggestion:
                    "Your code took too long to run. Please optimize for performance, reduce complexity, or process a smaller amount of data.",
            };
        }

        if (err.message.includes("SecurityError")) {
            return {
                name: "SecurityError",
                message: err.message,
                stack: err.stack,
                suggestion:
                    "The code attempted a restricted operation. You can only import from the allowed modules list and access files within the '/workspace' directory. Please modify the code to comply with the security policy.",
            };
        }

        // Pyodide 包装的 Python 异常
        if (err.name === "PythonError") {
            const messageLines = err.message.split("\n");
            const errorType = messageLines[messageLines.length - 2]; // e.g., "NameError: name 'x' is not defined"

            if (errorType.startsWith("SyntaxError")) {
                suggestion =
                    "The code has a Python syntax error. Please check for typos, indentation issues, or incorrect grammar.";
            } else if (errorType.startsWith("NameError")) {
                suggestion =
                    "A variable or function was used before it was defined. Ensure all variables are assigned and all necessary libraries (from the allowed list) are imported correctly.";
            } else if (errorType.startsWith("ModuleNotFoundError")) {
                suggestion = `The code tried to import a module that is not available or not allowed. You can only import from this list: [${this.config.allowedModules.join(
                    ", "
                )}].`;
            } else if (errorType.startsWith("TypeError")) {
                suggestion =
                    "An operation was applied to an object of an inappropriate type. Check the data types of the variables involved in the error line.";
            } else if (errorType.startsWith("IndexError") || errorType.startsWith("KeyError")) {
                suggestion =
                    "The code tried to access an element from a list or dictionary with an invalid index or key. Check if the index is within the bounds of the list or if the key exists in the dictionary.";
            }
        }

        return {
            name: err.name,
            message: err.message,
            stack: err.stack,
            suggestion: suggestion,
        };
    }

    getToolDefinition(): ToolDefinition {
        const defaultDescription = `Executes Python code in a sandboxed WebAssembly-based environment (Pyodide).
- Python Version: 3.11
- Pre-installed Libraries: ${this.config.packages.join(", ") || "Python Standard Library"}
- Allowed Importable Modules: ${this.config.allowedModules.join(", ")}
- Use print() to output results. The final expression is also automatically printed.
- File I/O is restricted to a temporary '/workspace' directory.
- Generate visualizations (e.g., with matplotlib) or files using the built-in '__create_artifact__' function. These will be returned as downloadable assets.`;

        return {
            name: "execute_python",
            description: this.config.customToolDescription || defaultDescription,
            parameters: withInnerThoughts({
                code: Schema.string().required().description("The Python code to execute."),
            }),
            execute: async ({ code }) => this.execute(code),
        };
    }

    async execute(code: string): Promise<CodeExecutionResult> {
        if (!this.isReady) {
            return {
                status: "error",
                error: {
                    name: "EnvironmentError",
                    message: "Python executor is not ready or failed to initialize.",
                    suggestion: "Please wait a moment and try again, or contact the administrator.",
                },
            };
        }

        let engine: PyodideInterface | null = null;
        try {
            this._checkCodeSecurity(code);

            engine = await this.pool.acquire();
            await this._resetEngineState(engine);

            const artifacts: ExecutionArtifact[] = [];
            const createArtifact = async (
                fileName: PyProxy | string,
                content: PyProxy | ArrayBuffer | string,
                type: PyProxy | AssetType
            ) => {
                const jsFileName = typeof fileName === "string" ? fileName : fileName.toJs();
                const jsType = (typeof type === "string" ? type : type.toJs()) as AssetType;

                if (!["text", "json", "html", "image", "file"].includes(jsType)) {
                    throw new Error(
                        `Invalid artifact type: '${jsType}'. Must be one of 'text', 'json', 'html', 'image', 'file'.`
                    );
                }

                let bufferContent: Buffer | string;
                if (typeof content === "string" || content instanceof ArrayBuffer) {
                    bufferContent = content instanceof ArrayBuffer ? Buffer.from(content) : content;
                } else {
                    // It's a PyProxy, likely bytes or BytesIO, convert it to a JS Buffer.
                    const pyBuffer = content.toJs(); // This should result in a Uint8Array for bytes.
                    bufferContent = Buffer.from(pyBuffer);
                }

                // const assetId = await this.resourceManager.create(bufferContent, jsType);
                const assetId = await this.assetService.create(bufferContent, jsType, { filename: jsFileName });
                artifacts.push({ assetId, type: jsType, fileName: jsFileName });
            };

            engine.globals.set("__create_artifact__", createArtifact);
            // 确保 /workspace 存在
            engine.FS.mkdirTree("/workspace");

            let stdout: string[] = [];
            let stderr: string[] = [];
            engine.setStdout({ batched: (msg) => stdout.push(msg) });
            engine.setStderr({ batched: (msg) => stderr.push(msg) });

            // Wrap user code to handle matplotlib plots automatically
            const wrappedCode = `
import matplotlib
matplotlib.use('Agg') # <--- [核心优化] 在这里自动设置后端!

import io
import matplotlib.pyplot as plt

# --- 用户代码开始 ---
${code}
# --- 用户代码结束 ---

# 自动检查并保存图表
# 如果用户代码中已经有 plt.savefig() 和 __create_artifact__，这部分可能会重复保存，但通常是安全的。
# 更好的做法是让LLM依赖这个自动机制。
if plt.get_fignums():
    for i in plt.get_fignums():
        plt.figure(i) # 切换到指定的 figure
        buf = io.BytesIO()
        plt.savefig(buf, format='png', bbox_inches='tight')
        buf.seek(0)

        # 为多个图表创建唯一的 artifact 名称
        __create_artifact__(f'chart_{i}.png', buf.getvalue(), 'image')

    plt.close('all') # 关闭所有图表
`;

            const executionPromise = engine.runPythonAsync(wrappedCode);

            const result = await Promise.race([
                executionPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error("TimeoutError")), this.config.timeout)),
            ]);

            if (result !== undefined && result !== null) {
                stdout.push(String(result));
            }

            return {
                status: "success",
                result: {
                    stdout: stdout.join("\n"),
                    stderr: stderr.join("\n"),
                    artifacts: artifacts,
                },
            };
        } catch (error) {
            return {
                status: "error",
                error: this._parsePyodideError(error),
            };
        } finally {
            if (engine) {
                // 清理注入的函数并释放回池中
                engine.globals.delete("__create_artifact__");
                this.pool.release(engine);
            }
        }
    }
}
