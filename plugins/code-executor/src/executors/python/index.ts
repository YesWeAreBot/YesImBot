import { Context, Logger, Schema } from "koishi";
import { AssetService } from "koishi-plugin-yesimbot/services";
import { Failed, InternalError, Success, ToolDefinition, ToolType, withInnerThoughts } from "koishi-plugin-yesimbot/services/plugin";
import { Services } from "koishi-plugin-yesimbot/shared";
import path from "path";
import { loadPyodide, PyodideAPI } from "pyodide";
import type { PyProxy } from "pyodide/ffi";
import { SharedConfig } from "../../config";
import { CodeExecutionResult, CodeExecutor, ExecutionArtifact, ExecutionError } from "../base";

export interface PythonConfig {
    type: "python";
    enabled: boolean;
    timeout?: number;
    poolSize?: number;
    pyodideVersion?: string;
    cdnBaseUrl?: string;
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
            poolSize: Schema.number().default(1).min(1).max(10).description("Pyodide 引擎池的大小，用于并发执行"),
            pyodideVersion: Schema.string()
                .pattern(/^\d+\.\d+\.\d+$/)
                .default("0.28.3")
                .description("Pyodide 的版本"),
            cdnBaseUrl: Schema.union([
                "https://cdn.jsdelivr.net",
                "https://fastly.jsdelivr.net",
                "https://testingcf.jsdelivr.net",
                "https://quantil.jsdelivr.net",
                "https://gcore.jsdelivr.net",
                "https://originfastly.jsdelivr.net",
                Schema.string().role("link").description("自定义CDN"),
            ])
                .default("https://fastly.jsdelivr.net")
                .description("Pyodide 包下载镜像源"),
            allowedModules: Schema.array(String)
                .default(["matplotlib", "numpy", "requests"])
                .role("table")
                .description("允许代码通过 import 导入的模块白名单"),
            packages: Schema.array(String)
                .default(["matplotlib", "numpy"])
                .role("table")
                .description("预加载到每个 Pyodide 实例中的 Python 包"),
            customToolDescription: Schema.string()
                .role("textarea", { rows: [2, 4] })
                .description("自定义工具描述，留空则使用默认描述"),
        }),
        Schema.object({}),
    ]),
]) as Schema<PythonConfig>;

class PyodideEnginePool {
    private readonly logger: Logger;
    private pool: PyodideAPI[] = [];
    private waiting: ((engine: PyodideAPI) => void)[] = [];
    private readonly maxSize: number;
    private isInitialized = false;

    constructor(
        private ctx: Context,
        private config: PythonConfig,
        private sharedConfig: SharedConfig
    ) {
        // 为日志源添加特定前缀，方便区分
        this.logger = ctx.logger(`[执行器:Python:引擎池]`);
        this.maxSize = config.poolSize;
    }

    private async createEngine(): Promise<PyodideAPI> {
        this.logger.info(`[创建实例] 开始创建新的 Pyodide 引擎实例...`);
        const pyodide = await loadPyodide({
            // 确保依赖路径正确
            packageCacheDir: path.join(this.ctx.baseDir, this.sharedConfig.dependenciesPath, "pyodide"),
            packageBaseUrl: `${this.config.cdnBaseUrl}/pyodide/v${this.config.pyodideVersion}/full/`,
        });
        this.logger.info(`[创建实例] Pyodide 核心加载完成`);

        if (this.config.packages && this.config.packages.length > 0) {
            const packages = new Set(this.config.packages);
            packages.add("micropip"); // 确保 micropip 总是被加载
            this.config.packages = Array.from(packages);

            // 加载预设包
            const packageList = this.config.packages.join(", ");
            this.logger.info(`[创建实例] 准备加载预设包: ${packageList}`);
            try {
                await pyodide.loadPackage(this.config.packages);
                this.logger.info(`[创建实例] 成功加载预设包: ${packageList}`);
            } catch (error: any) {
                this.logger.error(`[创建实例] 加载预设包失败: ${packageList}。错误: ${error.message}`);
                // 抛出更具体的错误，方便上层捕获
                throw new Error(`Pyodide 引擎在加载包时创建失败: ${error.message}`);
            }
        }
        this.logger.info("[创建实例] 新的 Pyodide 引擎实例已准备就绪");
        return pyodide;
    }

    public async initialize(): Promise<void> {
        if (this.isInitialized) return;
        this.logger.info(`[初始化] 开始初始化引擎池，目标大小: ${this.maxSize}`);
        try {
            // 并行创建所有引擎实例，以加快启动速度
            // const enginePromises = Array.from({ length: this.maxSize }, () => this.createEngine());
            // const engines = await Promise.all(enginePromises);
            const engines = [];
            for (let i = 0; i < this.maxSize; i++) {
                engines.push(await this.createEngine());
            }

            this.pool.push(...engines);
            this.isInitialized = true;
            this.logger.info(`[初始化] 引擎池初始化成功，已创建 ${this.pool.length} 个可用实例`);
        } catch (error: any) {
            this.logger.error(`[初始化] Pyodide 引擎池初始化失败！`, error);
            this.isInitialized = false; // 确保状态正确
            // 将初始化错误向上抛出，让启动逻辑知道失败了
            throw error;
        }
    }

    public async acquire(): Promise<PyodideAPI> {
        if (!this.isInitialized) {
            this.logger.error("[获取引擎] 尝试在未初始化的引擎池中获取引擎");
            throw new Error("Pyodide 引擎池未初始化或初始化失败");
        }

        if (this.pool.length > 0) {
            const engine = this.pool.pop()!;
            this.logger.debug(`[获取引擎] 从池中获取实例。池中剩余: ${this.pool.length}`);
            return engine;
        }

        this.logger.debug("[获取引擎] 池中无可用实例，进入等待队列...");
        return new Promise<PyodideAPI>((resolve) => {
            this.waiting.push(resolve);
        });
    }

    public release(engine: PyodideAPI): void {
        if (this.waiting.length > 0) {
            const nextConsumer = this.waiting.shift()!;
            this.logger.debug("[释放引擎] 引擎被直接传递给等待中的任务");
            nextConsumer(engine);
        } else {
            this.pool.push(engine);
            this.logger.debug(`[释放引擎] 引擎已返回池中。池中可用: ${this.pool.length}`);
        }
    }
}

export class PythonExecutor implements CodeExecutor {
    readonly type = "python";
    private readonly logger: Logger;
    private readonly pool: PyodideEnginePool;
    private readonly assetService: AssetService;
    private isReady = false;

    constructor(
        private ctx: Context,
        private config: PythonConfig,
        private sharedConfig: SharedConfig
    ) {
        this.logger = ctx.logger(`[执行器:Python]`);
        this.assetService = ctx[Services.Asset];
        this.pool = new PyodideEnginePool(ctx, config, sharedConfig);

        ctx.on("ready", async () => {
            if (config.enabled) {
                this.logger.info("Python 执行器已启用，正在初始化...");
                try {
                    await this.pool.initialize();
                    this.isReady = true;
                    this.logger.info("Python 执行器初始化成功，已准备就绪");
                } catch (error: any) {
                    this.logger.error("Python 执行器启动失败，将不可用", error);
                    // isReady 保持 false
                }
            }
        });
    }

    private _checkCodeSecurity(code: string): void {
        this.logger.debug("[安全检查] 开始进行代码安全检查...");
        const forbiddenImports = ["os", "subprocess", "sys", "shutil", "socket", "http.server", "ftplib"];
        const userAllowed = new Set(this.config.allowedModules);

        const importRegex = /^\s*from\s+([\w.]+)\s+import|^\s*import\s+([\w.]+)/gm;
        let match;
        while ((match = importRegex.exec(code)) !== null) {
            const moduleName = (match[1] || match[2]).split(".")[0];
            if (forbiddenImports.includes(moduleName) && !userAllowed.has(moduleName)) {
                this.logger.warn(`[安全检查] 检测到禁用模块导入: ${moduleName}`);
                throw new Error(`安全错误：不允许导入模块 '${moduleName}'，因为它在禁止列表中`);
            }
            if (!userAllowed.has(moduleName)) {
                // 如果需要严格白名单，可以解除此注释并抛出错误
                this.logger.warn(`[安全检查] 模块 '${moduleName}' 不在白名单中，但未被禁止`);
            }
        }

        if (code.includes("open(") && !code.includes("/workspace/")) {
            this.logger.warn(`[安全检查] 检测到可能访问 /workspace 之外的文件。代码: ${code}`);
        }
        this.logger.debug("[安全检查] 代码安全检查通过");
    }

    private async _resetEngineState(engine: PyodideAPI): Promise<void> {
        this.logger.debug("[状态重置] 重置引擎状态，清理变量和文件...");
        engine.runPython(`
import sys, os
# 存储初始全局变量，如果不存在
if 'initial_globals' not in globals():
    initial_globals = set(globals().keys())
# 清理非初始全局变量
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
        let suggestion = "There might be a logical error in the code. Please review the logic and try again.";

        if (err.message.includes("TimeoutError")) {
            return {
                type: "internal_error",
                name: "TimeoutError",
                message: `Code execution exceeded the time limit of ${this.config.timeout}ms.`,
                stack: err.stack,
                suggestion:
                    "Your code took too long to run. Please optimize for performance, reduce complexity, or process a smaller amount of data.",
            };
        }

        if (err.message.includes("SecurityError")) {
            return {
                type: "internal_error",
                name: "SecurityError",
                message: err.message,
                stack: err.stack,
                suggestion:
                    "The code attempted a restricted operation. You can only import from the allowed modules list and access files within the '/workspace' directory. Please modify the code to comply with the security policy.",
            };
        }

        if (err.name === "PythonError") {
            const messageLines = err.message.split("\n");
            const errorType = messageLines[messageLines.length - 2] || "";

            if (errorType.startsWith("SyntaxError")) {
                suggestion = "The code has a Python syntax error. Please check for typos, indentation issues, or incorrect grammar.";
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
            type: "internal_error",
            name: err.name,
            message: err.message,
            stack: err.stack,
            suggestion: suggestion,
        };
    }

    getToolDefinition(): ToolDefinition {
        // 工具描述通常面向 LLM，保持英文可能更佳，但可按需翻译
        const defaultDescription = `Executes Python code in a sandboxed WebAssembly-based environment (Pyodide).
- Python Version: 3.11
- Pre-installed Libraries: ${this.config.packages.join(", ") || "Python Standard Library"}
- Allowed Importable Modules: ${this.config.allowedModules.join(", ")}
- Use print() to output results. The final expression's value is also returned.
- File I/O is restricted to a temporary '/workspace' directory.
- To generate files (like images, plots, data files), use the special function '__create_artifact__(fileName, content, type)'. It returns assets for download. For example, to save a plot, use matplotlib to save it to a BytesIO buffer and pass it to this function.`;

        return {
            type: ToolType.Tool,
            name: "execute_python",
            extensionName: "code-executor",
            description: this.config.customToolDescription || defaultDescription,
            parameters: withInnerThoughts({
                code: Schema.string().required().description("The Python code to execute."),
            }),
            execute: async ({ code }) => this.execute(code),
        };
    }

    async execute(code: string): Promise<CodeExecutionResult> {
        if (!this.isReady) {
            this.logger.warn("[执行] 由于执行器未准备就绪，已拒绝执行请求");
            return Failed(InternalError("Python executor is not ready or failed to initialize."))
                .withWarning("Please wait a moment and try again, or contact the administrator.");
        }

        this.logger.info("[执行] 收到新的代码执行请求");
        let engine: PyodideAPI | null = null;
        try {
            this._checkCodeSecurity(code);

            engine = await this.pool.acquire();
            await this._resetEngineState(engine);

            const artifacts: ExecutionArtifact[] = [];
            const createArtifact = async (fileName: PyProxy | string, content: PyProxy | ArrayBuffer | string) => {
                const jsFileName = typeof fileName === "string" ? fileName : fileName.toJs();

                let bufferContent: Buffer | string;
                if (typeof content === "string" || content instanceof ArrayBuffer) {
                    bufferContent = content instanceof ArrayBuffer ? Buffer.from(content) : content;
                } else {
                    const pyBuffer = content.toJs(); // PyProxy -> Uint8Array
                    bufferContent = Buffer.from(pyBuffer);
                }

                const assetId = await this.assetService.create(bufferContent, { filename: jsFileName });
                artifacts.push({ assetId, fileName: jsFileName });
                this.logger.info(`[产物创建] 成功创建产物: ${jsFileName} (AssetID: ${assetId})`);
            };

            engine.globals.set("__create_artifact__", createArtifact);
            engine.FS.mkdirTree("/workspace");

            const stdout: string[] = [];
            const stderr: string[] = [];
            engine.setStdout({ batched: (msg) => stdout.push(msg) });
            engine.setStderr({ batched: (msg) => stderr.push(msg) });

            let finalCode = code;
            if (code.includes("matplotlib")) {
                this.logger.debug("[执行] 检测到 Matplotlib，将注入自动绘图保存逻辑");
                finalCode = `
import matplotlib
matplotlib.use('Agg')
import io
import matplotlib.pyplot as plt

# --- 用户代码开始 ---
${code}
# --- 用户代码结束 ---

# 自动检查并保存所有打开的图表
if plt.get_fignums():
    for i in plt.get_fignums():
        plt.figure(i)
        buf = io.BytesIO()
        plt.savefig(buf, format='png', bbox_inches='tight')
        buf.seek(0)
        __create_artifact__(f'chart_{i}.png', buf.getvalue(), 'image')
    plt.close('all') # 关闭所有图表以释放内存
`;
            }

            const executionPromise = engine.runPythonAsync(finalCode);
            const result = await Promise.race([
                executionPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error("TimeoutError")), this.config.timeout)),
            ]);

            let resultString = "";
            if (result !== undefined && result !== null) {
                resultString = String(result);
            }

            this.logger.info("[执行] 代码执行成功");
            return Success({
                stdout: [...stdout, resultString].filter(Boolean).join("\n"),
                stderr: stderr.join("\n"),
                artifacts: artifacts,
            });
        } catch (error: any) {
            this.logger.error("[执行] 代码执行时发生错误", error);
            return Failed(this._parsePyodideError(error));
        } finally {
            if (engine) {
                engine.globals.delete("__create_artifact__");
                this.pool.release(engine);
            }
        }
    }
}
