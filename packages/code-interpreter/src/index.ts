import * as childProcess from "child_process";
import * as crypto from "crypto";
import fs from "fs/promises";
import { Context, Schema } from "koishi";
import path from "path";
import { promisify } from "util";
import { Worker } from "worker_threads";

import { Extension, Failed, Infer, Success, Tool, withInnerThoughts } from "koishi-plugin-yesimbot/services";

const exec = promisify(childProcess.exec);

export interface CodeInterpreterConfig {
    timeout: number;
    packageManager: "npm" | "yarn" | "bun";
    allowedBuiltins: string[];
    allowedModules: string[];
    dependenciesPath: string;
    enableCache: boolean;
    cacheTTL: number;
}

@Extension({
    name: "code-interpreter",
    display: "代码解释器",
    description: "提供一个安全的沙箱环境，用于执行由AI生成的JavaScript代码。",
    author: "AI-Powered Design",
    version: "1.0.0",
})
export default class CodeInterpreterExtension {
    static readonly Config: Schema<CodeInterpreterConfig> = Schema.object({
        timeout: Schema.number().default(10000).description("代码执行的超时时间（毫秒）。"),
        packageManager: Schema.union(["npm", "yarn", "bun"])
            .default("npm")
            .description("用于动态安装依赖的包管理器。请确保您选择的包管理器已在系统环境中安装。"),
        allowedBuiltins: Schema.array(String)
            .default(["os", "path", "util"])
            .description("允许在沙箱中使用的Node.js内置模块。"),
        allowedModules: Schema.array(String)
            .default(["lodash", "dayjs"])
            .description("允许动态安装和使用的外部npm模块白名单。"),
        dependenciesPath: Schema.string().default("./.sandbox_modules").description("动态安装的npm模块的存放路径。"),
        enableCache: Schema.boolean().default(true).description("是否启用代码执行结果缓存。"),
        cacheTTL: Schema.number()
            .default(3600 * 1000)
            .description("缓存的有效时间（毫秒）。"),
    });

    // 使用 Map 作为简单的内存缓存
    private resultCache = new Map<string, { result: any; timestamp: number }>();

    // 依赖注入
    constructor(public ctx: Context, public config: CodeInterpreterConfig) {
        // 在这里可以初始化依赖安装目录等
    }

    //@ts-ignore
    @Tool({
        name: "execute_javascript",
        description: `在一个隔离的、安全的Node.js沙箱环境中执行JavaScript代码。
- 支持顶层 'await'。
- 你可以通过 require() 导入模块，但仅限于管理员配置的白名单模块。
- 你可以打印日志到控制台，这些日志将作为执行结果返回。
- 返回结果仅你可见，根据返回结果调整你的下一步行动。
- 任何未捕获的异常或执行超时都将导致工具调用失败。`,
        parameters: withInnerThoughts({
            code: Schema.string().required().description("要执行的JavaScript代码字符串。"),
        }),
    })
    async executeJavascript({ code }: Infer<{ code: string }>) {
        // 1. 缓存检查 (逻辑不变)
        const cacheKey = this.generateCacheKey(code);
        if (this.config.enableCache && this.resultCache.has(cacheKey)) {
            const cached = this.resultCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.config.cacheTTL) {
                this.ctx.logger.info("[code-interpreter] Cache hit.");
                return Success({ result: cached.result, message: "Result from cache." });
            }
        }

        // 3. 动态依赖处理
        try {
            await this.handleDependencies(code);
        } catch (error) {
            this.ctx.logger.error(`[code-interpreter] Dependency installation failed: ${error.message}`);
            return Failed(`依赖安装失败: ${error.message}`);
        }

        // ✅ Step 2: Run the code in a worker for true isolation and timeout control.
        return new Promise((resolve) => {
            // Make sure the path points to your COMPILED worker file.
            const workerPath = path.resolve(__dirname, "worker.js");

            const worker = new Worker(workerPath, {
                workerData: {
                    code,
                    // Pass a serializable version of the config
                    config: {
                        timeout: this.config.timeout,
                        allowedModules: this.config.allowedModules,
                        allowedBuiltins: this.config.allowedBuiltins,
                        dependenciesPath: path.resolve(this.config.dependenciesPath), // Ensure absolute path
                    },
                },
            });

            // ✅ Step 3: Implement a reliable timeout on the main thread.
            const timeout = setTimeout(() => {
                this.ctx.logger.warn(`[code-interpreter] Worker forcefully terminated due to timeout.`);
                worker.terminate();
                resolve(Failed(`代码执行超时，超过了 ${this.config.timeout} 毫秒。`));
            }, this.config.timeout);

            worker.on("message", (result) => {
                clearTimeout(timeout); // Success, clear the timeout
                if (result.status === "success") {
                    if (this.config.enableCache) {
                        this.resultCache.set(cacheKey, { result: result.data, timestamp: Date.now() });
                    }
                    resolve(Success(result.data));
                } else {
                    const errorMessage = result.error.message.includes("timed out")
                        ? `代码执行超时（来自沙箱内部），超过了 ${this.config.timeout} 毫秒。`
                        : `执行时发生错误: ${result.error.message}`;
                    resolve(Failed(errorMessage, { console: result.error.console }));
                }
            });

            worker.on("error", (err) => {
                clearTimeout(timeout);
                this.ctx.logger.error(`[code-interpreter] Worker errored: ${err.message}`);
                resolve(Failed(`代码解释器工作线程发生严重错误: ${err.message}`));
            });

            worker.on("exit", (code) => {
                if (code !== 0) {
                    clearTimeout(timeout);
                    this.ctx.logger.warn(`[code-interpreter] Worker stopped with exit code ${code}`);
                    // Potentially resolve with a failure if it wasn't handled by 'message' or 'error'
                }
            });
        });
    }

    // 辅助方法
    private async handleDependencies(code: string) {
        // 确保依赖目录和 package.json 存在
        await fs.mkdir(this.config.dependenciesPath, { recursive: true });
        const packageJsonPath = path.join(this.config.dependenciesPath, "package.json");
        try {
            await fs.access(packageJsonPath);
        } catch {
            // 如果 package.json 不存在, 创建一个空的
            await fs.writeFile(packageJsonPath, '{ "name": "sandbox-dependencies" }');
        }

        const requiredModules = [...code.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

        if (requiredModules.length === 0) return; // 没有需要安装的依赖

        const uniqueModules = [...new Set(requiredModules)];

        for (const moduleName of uniqueModules) {
            if (this.config.allowedBuiltins.includes(moduleName)) continue; // 跳过内置模块
            if (!this.config.allowedModules.includes(moduleName)) {
                throw new Error(`模块 '${moduleName}' 不在允许的白名单中。`);
            }

            // 检查模块是否已安装，如果未安装则进行安装
            const modulePath = path.join(this.config.dependenciesPath, "node_modules", moduleName);
            try {
                await fs.access(modulePath);
                // 模块已存在，跳过安装
                continue;
            } catch {
                // 模块不存在，继续执行安装逻辑
            }

            this.ctx.logger.info(
                `[code-interpreter] Using ${this.config.packageManager} to install dependency: ${moduleName}`
            );

            let installCommand: string;
            switch (this.config.packageManager) {
                case "yarn":
                    installCommand = `yarn add ${moduleName}`;
                    break;
                case "bun":
                    installCommand = `bun add ${moduleName}`;
                    break;
                case "npm":
                default:
                    installCommand = `npm install ${moduleName}`;
                    break;
            }

            this.ctx.logger.info(`[code-interpreter] Ensuring dependency: ${moduleName}`);
            await exec(installCommand, { cwd: this.config.dependenciesPath });
        }
    }

    private generateCacheKey(code: string): string {
        return crypto.createHash("sha256").update(code).digest("hex");
    }
}
