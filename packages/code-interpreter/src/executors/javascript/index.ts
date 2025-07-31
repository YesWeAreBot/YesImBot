import { exec } from "child_process";
import fs from "fs/promises";
import { Context, Logger, Schema } from "koishi";
import { ToolDefinition, withInnerThoughts } from "koishi-plugin-yesimbot/services";
import path from "path";
import { promisify } from "util";
import { Worker } from "worker_threads";

import { SharedConfig } from "../../config";
import { CodeExecutionResult, CodeExecutor, ExecutionError } from "../base";

const asyncExec = promisify(exec);

export interface JavaScriptConfig {
    type: "javascript";
    enabled: boolean;
    packageManager: "npm" | "yarn" | "bun" | "pnpm";
    timeout: number;
    memoryLimit: number;
    allowedBuiltins: string[];
    allowedModules: string[];
    customToolDescription: string;
}

export const JavaScriptConfigSchema: Schema<JavaScriptConfig> = Schema.intersect([
    Schema.object({
        type: Schema.const("javascript").hidden().description("引擎类型"),
        enabled: Schema.boolean().default(false).description("是否启用此引擎"),
    }).description("JavaScript 执行引擎"),
    Schema.union([
        Schema.object({
            enabled: Schema.const(true).required(),
            timeout: Schema.number().default(10000).description("代码执行的超时时间（毫秒）"),
            packageManager: Schema.union(["npm", "yarn", "bun", "pnpm"])
                .default("npm")
                .description("用于动态安装依赖的包管理器"),
            memoryLimit: Schema.number().min(64).default(128).description("代码执行的内存限制（MB）"),
            allowedBuiltins: Schema.array(String)
                .default(["path", "util", "crypto"])
                .role("table")
                .description("允许使用的Node.js内置模块"),
            allowedModules: Schema.array(String)
                .default([])
                .role("table")
                .description("允许动态安装的外部npm模块白名单"),
            customToolDescription: Schema.string()
                .role("textarea", { rows: [2, 4] })
                .description("自定义工具描述，留空则使用默认描述"),
        }),
        Schema.object({}),
    ]),
]) as Schema<JavaScriptConfig>;

export class JavaScriptExecutor implements CodeExecutor {
    readonly type = "javascript";
    private readonly logger: Logger;

    constructor(private ctx: Context, private config: JavaScriptConfig, private sharedConfig: SharedConfig) {
        this.logger = ctx.logger(`[executor:${this.type}]`);
        this.logger.info("JavaScript executor initialized.");
    }

    public getToolDefinition(): ToolDefinition {
        const defaultDescription = `在一个隔离的、安全的Node.js沙箱环境中执行JavaScript代码
- 你可以使用 require() 导入模块，但仅限于管理员配置的内置模块和外部模块白名单
- 可用内置模块: ${this.config.allowedBuiltins.join(", ") || "无"}
- 可用外部模块: ${this.config.allowedModules.join(", ") || "无"}
- 必须使用 console.log() 输出结果，它将作为 stdout 返回
- 返回结果仅你可见，根据返回结果调整你的下一步行动
- 任何未捕获的异常或执行超时都将导致工具调用失败
- 可以使用 'fs' 等模块与文件系统交互，生成的文件将保存在安全目录并可能返回URL`;

        return {
            name: "execute_javascript",
            description: this.config.customToolDescription || defaultDescription,
            parameters: withInnerThoughts({
                code: Schema.string().required().description("要执行的JavaScript代码字符串"),
            }),
            execute: async ({ code }) => this.execute(code),
        };
    }

    public async execute(code: string): Promise<CodeExecutionResult> {
        this.logger.info(`Received code execution request.`);

        try {
            await this.prepareEnvironment(code);
        } catch (error) {
            this.logger.error("Environment preparation failed.", error);
            return {
                status: "error",
                error: {
                    name: "EnvironmentError",
                    message: error.message,
                    stack: error.stack,
                    suggestion: "请检查模块名是否正确，或请求管理员将所需模块添加到白名单中",
                },
            };
        }

        try {
            const resultFromWorker = await this.runWorker(code);

            return {
                status: "success",
                result: {
                    stdout: this.truncate(resultFromWorker.stdout),
                    stderr: this.truncate(resultFromWorker.stderr),
                    artifacts: resultFromWorker.artifacts || [],
                },
            };
        } catch (error) {
            const execError = error as ExecutionError;
            return {
                status: "error",
                error: {
                    name: execError.name || "ExecutionError",
                    message: execError.message,
                    stack: execError.stack,
                    suggestion:
                        execError.suggestion ||
                        "请检查代码中的语法错误、变量拼写、以及是否正确处理了 null 或 undefined 的情况。查看下方日志获取详细信息。",
                },
            };
        }
    }

    /**
     * 在一个独立的 Worker 线程中运行代码，以实现隔离和资源限制
     * @param code 要执行的代码
     * @returns 一个解析为执行结果的 Promise
     */
    private runWorker(code: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const workerPath = path.resolve(__dirname, "worker.js");
            const worker = new Worker(workerPath, {
                workerData: {
                    code,
                    config: {
                        timeout: this.config.timeout,
                        memoryLimit: this.config.memoryLimit,
                        allowedModules: this.config.allowedModules,
                        allowedBuiltins: this.config.allowedBuiltins,
                        dependenciesPath: path.resolve(this.sharedConfig.dependenciesPath),
                    },
                },
                resourceLimits: {
                    maxOldGenerationSizeMb: this.config.memoryLimit,
                },
            });

            const timeoutId = setTimeout(() => {
                worker.terminate();
                const timeoutError: ExecutionError = {
                    name: "TimeoutError",
                    message: `代码执行超时。最长允许执行时间为 ${this.config.timeout / 1000} 秒`,
                    suggestion:
                        "请检查你的代码是否存在无限循环或长时间运行的操作。尝试优化算法或将任务分解成更小的步骤",
                };
                reject(timeoutError);
            }, this.config.timeout);

            worker.on("message", (result) => {
                clearTimeout(timeoutId);
                if (result.status === "success") {
                    resolve(result.data);
                } else {
                    reject(result.error);
                }
            });

            worker.on("error", (err) => {
                clearTimeout(timeoutId);
                this.logger.error(`Worker thread encountered a critical error: ${err.stack}`);
                const criticalError: ExecutionError = {
                    name: "WorkerCriticalError",
                    message: `代码解释器工作线程发生严重错误: ${err.message}`,
                    stack: err.stack,
                    suggestion:
                        "这个问题可能源于工具本身或其环境配置。请尝试简化代码，如果问题依旧，这可能是一个需要上报的系统级错误。",
                };
                reject(criticalError);
            });

            worker.on("exit", (code) => {
                if (code !== 0) {
                    this.logger.warn(
                        `Worker stopped with non-zero exit code: ${code}. This might indicate a crash due to memory limits or other unhandled errors.`
                    );
                }
            });
        });
    }

    /**
     * 准备执行环境，主要是安装代码中所需的、且在白名单内的依赖
     * @param code 要分析依赖的代码
     */
    private async prepareEnvironment(code: string): Promise<void> {
        await fs.mkdir(this.sharedConfig.dependenciesPath, { recursive: true });
        const packageJsonPath = path.join(this.sharedConfig.dependenciesPath, "package.json");
        try {
            await fs.access(packageJsonPath);
        } catch {
            await fs.writeFile(packageJsonPath, JSON.stringify({ name: "sandbox-dependencies", private: true }));
            this.logger.info(`Created package.json in dependency path: ${packageJsonPath}`);
        }

        const requiredModules = [...code.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
        if (requiredModules.length === 0) return;

        this.logger.debug(`Detected required modules: ${requiredModules.join(", ")}`);
        const uniqueModules = [...new Set(requiredModules)];
        const allowedSet = new Set([...this.config.allowedBuiltins, ...this.config.allowedModules]);

        for (const moduleName of uniqueModules) {
            if (!allowedSet.has(moduleName)) {
                /* prettier-ignore */
                const suggestion = `你可以使用的模块列表为: [${[...allowedSet].join(", ")}]。请修改代码，只使用列表中的模块，或者请求管理员将 '${moduleName}' 添加到白名单。`;
                throw new Error(`模块导入失败 - 模块 '${moduleName}' 不在允许的白名单中。\n${suggestion}`);
            }

            if (this.config.allowedBuiltins.includes(moduleName)) {
                this.logger.debug(`Skipping installation for built-in module: ${moduleName}`);
                continue;
            }

            try {
                require.resolve(moduleName, { paths: [this.sharedConfig.dependenciesPath] });
                this.logger.info(`Dependency '${moduleName}' is already installed. Skipping.`);
            } catch {
                this.logger.info(`Installing dependency: ${moduleName}`);
                await this.installPackage(moduleName);
            }
        }
    }

    /**
     * 使用配置的包管理器安装指定的包。
     * @param moduleName 要安装的模块名。
     */
    private async installPackage(moduleName: string): Promise<void> {
        const pm = this.config.packageManager;
        let installCommand: string;
        switch (pm) {
            case "yarn":
                installCommand = `yarn add ${moduleName} --silent --non-interactive`;
                break;
            case "bun":
                installCommand = `bun add ${moduleName}`;
                break;
            case "pnpm":
                installCommand = `pnpm add ${moduleName}`;
                break;
            case "npm":
            default:
                installCommand = `npm install ${moduleName} --no-save --omit=dev`;
                break;
        }

        try {
            this.logger.info(`Executing: \`${installCommand}\` in ${this.sharedConfig.dependenciesPath}`);
            await asyncExec(installCommand, { cwd: this.sharedConfig.dependenciesPath });
            this.logger.info(`Successfully installed ${moduleName}`);
        } catch (error) {
            const stderr = error.stderr || "No stderr output.";
            this.logger.error(`Failed to install ${moduleName}. Stderr: ${stderr}`, error);
            const suggestion = `请检查模块名 '${moduleName}' 是否拼写正确，以及它是否存在于 ${pm} 仓库中。`;
            throw new Error(`依赖安装失败: 无法安装模块 '${moduleName}'。\n错误详情: ${stderr}\n${suggestion}`);
        }
    }

    /**
     * 截断过长的输出文本。
     * @param text 输入文本。
     * @returns 截断后的文本。
     */
    private truncate(text: string): string {
        if (!text) return "";
        const maxLength = this.sharedConfig.maxOutputSize;
        if (text.length > maxLength) {
            return text.substring(0, maxLength) + `\n... [输出内容过长，已被截断，限制为 ${maxLength} 字符]`;
        }
        return text;
    }
}
