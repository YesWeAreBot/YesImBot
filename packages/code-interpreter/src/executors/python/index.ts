import { Context, Logger, Schema } from "koishi";
import { ToolDefinition, withInnerThoughts } from "koishi-plugin-yesimbot/services";

import path from "path";
import { loadPyodide, PyodideInterface } from "pyodide";
import { SharedConfig } from "../../config";
import { CodeExecutor, CodeExecutionResult } from "../base";

export interface PythonConfig {
    type: "python";
    enabled: boolean;
    timeout?: number;
    pyodideVersion?: string;
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
            timeout: Schema.number().default(15000).description("代码执行的超时时间（毫秒）"),
            pyodideVersion: Schema.string().default("v0.25.1").description("Pyodide 的版本"),
            packages: Schema.array(String).default(["numpy", "pandas"]).role("table").description("预加载的 Python 包"),
            customToolDescription: Schema.string()
                .role("textarea", { rows: [2, 4] })
                .description("自定义工具描述，留空则使用默认描述"),
        }),
        Schema.object({}),
    ]),
]) as Schema<PythonConfig>;

export class PythonExecutor implements CodeExecutor {
    readonly type = "python";
    private readonly logger: Logger;
    private pyodide: PyodideInterface | null = null;

    constructor(private ctx: Context, private config: PythonConfig, private sharedConfig: SharedConfig) {
        this.logger = ctx.logger(`[executor:${this.type}]`);
        this.initializePyodide();
    }

    private async initializePyodide() {
        try {
            this.logger.info("Initializing Pyodide runtime...");
            this.pyodide = await loadPyodide({
                // Pyodide 在 node 环境需要一个包目录
                packageCacheDir: path.join(this.sharedConfig.dependenciesPath, "pyodide"),
            });
            if (this.config.packages.length > 0) {
                this.logger.info(`Loading packages: ${this.config.packages.join(", ")}`);
                await this.pyodide.loadPackage(this.config.packages);
            }
            this.logger.info("Pyodide runtime ready.");
        } catch (error) {
            this.logger.error("Failed to initialize Pyodide:", error);
            this.pyodide = null;
        }
    }

    getToolDefinition(): ToolDefinition {
        const defaultDescription = `在一个基于 WebAssembly 的沙箱环境中执行 Python 代码 (Pyodide)。
- Python 版本: (由 Pyodide 决定, e.g., 3.11)
- 预装库: ${this.config.packages.join(", ") || "标准库"}
- 使用 print() 函数输出结果。
- 可以使用 matplotlib 生成图表，图表将作为图片返回。
- 执行超时: ${this.config.timeout / 1000}s。`;

        return {
            name: "execute_python",
            description: this.config.customToolDescription || defaultDescription,
            parameters: withInnerThoughts({
                code: Schema.string().required().description("要执行的 Python 代码。"),
            }),
            execute: async ({ code }) => this.execute(code),
        };
    }

    async execute(code: string): Promise<CodeExecutionResult> {
        if (!this.pyodide) {
            return {
                status: "error",
                error: {
                    name: "System Error",
                    message: "Pyodide runtime is not available.",
                },
            };
        }

        let stdout = [];
        let stderr = [];
        this.pyodide.setStdout({ batched: (msg) => stdout.push(msg) });
        this.pyodide.setStderr({ batched: (msg) => stderr.push(msg) });

        try {
            // 超时处理
            const result = await Promise.race([
                this.pyodide.runPythonAsync(code),
                new Promise((_, reject) => setTimeout(() => reject(new Error("TimeoutError")), this.config.timeout)),
            ]);

            // 在 Pyodide 中，最后的表达式结果会被返回
            if (result !== undefined && result !== null) {
                stdout.push(String(result));
            }

            return {
                status: "success",
                result: {
                    stdout: stdout.join("\n"),
                    stderr: stderr.join("\n"),
                },
            };
        } catch (error) {
            const isTimeout = error.message === "TimeoutError";
            return {
                status: "error",
                error: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                },
            };
        }
    }
}
