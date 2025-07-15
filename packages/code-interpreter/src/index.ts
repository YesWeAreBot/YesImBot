import * as childProcess from "child_process";
import * as crypto from "crypto";
import fs from "fs/promises";
import { Context, Schema } from "koishi";
import path from "path";
import { promisify } from "util";
import { Worker } from "worker_threads";

import { Extension, Failed, Infer, Success, Tool, withInnerThoughts } from "koishi-plugin-yesimbot/services";

const exec = promisify(childProcess.exec);

// (Config 接口和 Schema 定义保持不变)
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
            .default(["os", "path", "util", "url", "crypto", "buffer", "string_decoder"])
            .role("table")
            .description("允许在沙箱中使用的Node.js内置模块。"),
        allowedModules: Schema.array(String)
            .default([])
            .role("table")
            .description("允许动态安装和使用的外部npm模块白名单。"),
        dependenciesPath: Schema.path({ filters: ["directory"], allowCreate: true })
            .default("./.sandbox_modules")
            .description("动态安装的npm模块的存放路径。"),
        enableCache: Schema.boolean().default(true).description("是否启用代码执行结果缓存。"),
        cacheTTL: Schema.number()
            .default(3600 * 1000)
            .description("缓存的有效时间（毫秒）。"),
    });

    private resultCache = new Map<string, { result: any; timestamp: number }>();

    constructor(public ctx: Context, public config: CodeInterpreterConfig) {}

    //@ts-ignore
    @Tool({
        name: "execute_javascript",
        description: `在一个隔离的、安全的Node.js沙箱环境中执行JavaScript代码。
- 你可以使用 require() 导入模块，但仅限于管理员配置的内置模块和外部模块白名单。
- **重要**: 你必须通过 console.log(), console.warn(), console.error() 来输出结果。这些日志将作为工具的返回值，是你获取代码运行信息的唯一方式。
- 返回结果仅你可见，根据返回结果调整你的下一步行动。
- 任何未捕获的异常或执行超时都将导致工具调用失败。`,
        parameters: withInnerThoughts({
            code: Schema.string().required().description("要执行的JavaScript代码字符串。"),
        }),
    })
    async executeJavascript({ code }: Infer<{ code: string }>) {
        const cacheKey = this.generateCacheKey(code);
        if (this.config.enableCache && this.resultCache.has(cacheKey)) {
            const cached = this.resultCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.config.cacheTTL) {
                this.ctx.logger.info("[code-interpreter] Cache hit.");
                return Success(cached.result, { from_cache: true });
            }
        }

        try {
            await this.prepareEnvironment(code);
        } catch (error) {
            this.ctx.logger.warn(`[code-interpreter] Environment preparation failed: ${error.message}`);
            // 优化点 2: 为 LLM 提供清晰、可行动的错误反馈
            return Failed(error.message);
        }

        // 优化点 3: 使用 async/await 替代 new Promise 封装 worker 逻辑，代码更线性、易读
        try {
            const result = await this.runWorker(code);
            if (this.config.enableCache) {
                this.resultCache.set(cacheKey, { result, timestamp: Date.now() });
            }
            return Success(result);
        } catch (error) {
            // Worker 内部的错误（包括执行失败和超时）会被 catch
            this.ctx.logger.warn(`[code-interpreter] Execution failed: ${error.message}`);
            return Failed(error.message, error.details);
        }
    }

    private runWorker(code: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const workerPath = path.resolve(__dirname, "worker.js");
            const worker = new Worker(workerPath, {
                workerData: {
                    code,
                    config: {
                        timeout: this.config.timeout,
                        allowedModules: this.config.allowedModules,
                        allowedBuiltins: this.config.allowedBuiltins,
                        dependenciesPath: path.resolve(this.config.dependenciesPath),
                    },
                },
            });

            // 优化点 2: 更明确的超时信息
            const timeoutId = setTimeout(() => {
                worker.terminate();
                const errorMessage = `代码执行超时。最长允许执行时间为 ${this.config.timeout / 1000} 秒。`;
                const suggestion =
                    "建议: 请检查你的代码是否存在无限循环或长时间运行的操作。尝试优化算法或将任务分解成更小的步骤。";
                reject(new Error(`${errorMessage} ${suggestion}`));
            }, this.config.timeout);

            worker.on("message", (result) => {
                clearTimeout(timeoutId);
                if (result.status === "success") {
                    resolve(result.data);
                } else {
                    // 附带建议的错误信息
                    const suggestion =
                        "建议: 请检查代码中的语法错误、变量名拼写、以及是否正确处理了 null 或 undefined 的情况。查看下方控制台日志获取更详细的线索。";
                    const errorMessage = `代码执行时发生错误: ${result.error.message}\n${suggestion}`;
                    // 将console日志作为附加信息传递
                    const errorDetails = { console: result.error.console };
                    const error = new Error(errorMessage) as any;
                    error.details = errorDetails;
                    reject(error);
                }
            });

            worker.on("error", (err) => {
                clearTimeout(timeoutId);
                this.ctx.logger.error(`[code-interpreter] Worker thread error: ${err.message}`);
                const errorMessage = `代码解释器工作线程发生严重错误: ${err.message}`;
                const suggestion =
                    "建议: 这个问题可能源于工具本身或其环境配置。请尝试简化代码，如果问题依旧，这可能是一个需要上报的系统级错误。";
                reject(new Error(`${errorMessage} ${suggestion}`));
            });

            worker.on("exit", (code) => {
                if (code !== 0) {
                    // 非正常退出通常伴随着 'error' 事件，这里仅作日志记录
                    this.ctx.logger.warn(`[code-interpreter] Worker stopped with non-zero exit code: ${code}`);
                }
            });
        });
    }

    // 优化点 1: 统一的环境准备和依赖校验逻辑
    private async prepareEnvironment(code: string) {
        // 确保依赖目录和 package.json 存在
        await fs.mkdir(this.config.dependenciesPath, { recursive: true });
        const packageJsonPath = path.join(this.config.dependenciesPath, "package.json");
        try {
            await fs.access(packageJsonPath);
        } catch {
            await fs.writeFile(packageJsonPath, JSON.stringify({ name: "sandbox-dependencies", private: true }));
        }

        const requiredModules = [...code.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
        if (requiredModules.length === 0) return;

        const uniqueModules = [...new Set(requiredModules)];
        const allowedSet = new Set([...this.config.allowedBuiltins, ...this.config.allowedModules]);

        for (const moduleName of uniqueModules) {
            // 核心校验逻辑：所有模块都必须在白名单中
            if (!allowedSet.has(moduleName)) {
                // 为 LLM 提供清晰的错误和指导
                const suggestion = `你可以使用的模块列表为: [${[...allowedSet].join(
                    ", "
                )}]。请修改代码，只使用列表中的模块，或者请求管理员将 '${moduleName}' 添加到白名单。`;
                throw new Error(`模块导入失败: 模块 '${moduleName}' 不在允许的白名单中。\n${suggestion}`);
            }

            // 如果是内置模块，则跳过安装
            if (this.config.allowedBuiltins.includes(moduleName)) continue;

            // 检查外部模块是否已安装
            try {
                // 使用 require.resolve 检查更可靠
                require.resolve(moduleName, { paths: [this.config.dependenciesPath] });
                continue; // 模块已安装，跳过
            } catch {
                // 模块未安装，执行安装
                this.ctx.logger.info(`[code-interpreter] Installing dependency: ${moduleName}`);
                await this.installPackage(moduleName);
            }
        }
    }

    // 优化点 4: 将包安装逻辑提取为独立方法，并增加错误捕获
    private async installPackage(moduleName: string) {
        let installCommand: string;
        switch (this.config.packageManager) {
            case "yarn":
                installCommand = `yarn add ${moduleName} --silent`;
                break;
            case "bun":
                installCommand = `bun add ${moduleName}`;
                break;
            case "npm":
            default:
                installCommand = `npm install ${moduleName} --no-save`;
                break;
        }

        try {
            this.ctx.logger.info(`[code-interpreter] Executing: ${installCommand} in ${this.config.dependenciesPath}`);
            await exec(installCommand, { cwd: this.config.dependenciesPath });
            this.ctx.logger.info(`[code-interpreter] Successfully installed ${moduleName}`);
        } catch (error) {
            this.ctx.logger.error(
                `[code-interpreter] Failed to install ${moduleName}. Error: ${error.stderr || error.message}`
            );
            // 为 LLM 提供清晰的错误
            const suggestion = `建议: 请检查模块名 '${moduleName}' 是否拼写正确，以及它是否存在于 ${this.config.packageManager} 仓库中。`;
            throw new Error(`依赖安装失败: 无法安装模块 '${moduleName}'。\n${suggestion}`);
        }
    }

    private generateCacheKey(code: string): string {
        return crypto.createHash("sha256").update(code).digest("hex");
    }

    // 优化点 3: 移除了 _preprocessCodeForReturnValue 方法，因为它未被使用且与工具描述的输出方式（console.log）不一致。
}
