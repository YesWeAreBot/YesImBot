import ivm from "isolated-vm";
import path from "path";
import { parentPort, workerData } from "worker_threads";
import { ExecutionError } from "../base";

interface CapturedLog {
    level: "log" | "error" | "warn";
    message: string;
}

/**
 * 主执行函数，在沙箱中运行用户代码。
 */
async function executeInSandbox() {
    const { code, config } = workerData;
    const { allowedBuiltins, allowedModules, dependenciesPath, timeout, memoryLimit } = config;

    const capturedLogs: CapturedLog[] = [];
    const processedRequests = [];
    let isolate: ivm.Isolate;

    try {
        isolate = new ivm.Isolate({ memoryLimit });
        const context = await isolate.createContext();
        const jail = context.global;

        await jail.set("global", jail.derefInto());

        // 1. 实现 console 重定向，捕获所有输出
        const logCallback = new ivm.Reference((level: CapturedLog["level"], ...args: any[]) => {
            try {
                const message = args
                    .map((arg) => {
                        if (arg instanceof Error) {
                            return arg.stack;
                        }
                        return typeof arg === "string" ? arg : JSON.stringify(arg, null, 2);
                    })
                    .join(" ");
                capturedLogs.push({ level, message });
            } catch (e) {
                // 忽略日志记录本身可能出现的错误
            }
        });

        await context.evalClosure(
            `global.console = {
                log: (...args) => $0.applyIgnored(undefined, ['log', ...args]),
                error: (...args) => $0.applyIgnored(undefined, ['error', ...args]),
                warn: (...args) => $0.applyIgnored(undefined, ['warn', ...args]),
            };`,
            [logCallback]
        );

        const allowedSet = new Set([...allowedBuiltins, ...allowedModules]);
        const hostRequire = (moduleName: string) => {
            if (!allowedSet.has(moduleName)) {
                throw new Error(`不允许导入模块 '${moduleName}'。`);
            }
            // 内置模块直接加载
            if (allowedBuiltins.includes(moduleName)) {
                return require(moduleName);
            }
            // 外部模块从指定路径加载
            return require(path.join(dependenciesPath, "node_modules", moduleName));
        };

        const requireCallback = new ivm.Callback((moduleName: string) => {
            try {
                const mod = hostRequire(moduleName);

                // 如果模块不是对象或函数（例如，某些模块可能导出单个值），则直接复制。
                if (typeof mod !== "object" && typeof mod !== "function") {
                    return new ivm.ExternalCopy(mod).copyInto();
                }

                // 创建一个代理对象，用于安全地暴露模块功能
                const proxy = {};

                // 遍历模块的所有属性 (包括不可枚举的，例如 'default')
                for (const key of Object.getOwnPropertyNames(mod)) {
                    // 有些底层属性无法访问，直接跳过
                    try {
                        const prop = mod[key];

                        if (typeof prop === "function") {
                            // 如果属性是函数，创建一个 Callback，使其在沙箱内可调用
                            proxy[key] = new ivm.Callback(function (...args) {
                                return prop.apply(mod, args);
                            });
                        } else {
                            // 如果属性是数据（对象、字符串、数字等），则深拷贝它
                            proxy[key] = new ivm.ExternalCopy(prop).copyInto();
                        }
                    } catch (error) {
                        // 忽略无法访问的属性
                        continue;
                    }
                }

                // 将构建好的代理对象传递给沙箱
                return new ivm.ExternalCopy(proxy).copyInto();
            } catch (error) {
                throw new Error(`加载模块 '${moduleName}' 失败: ${error.message}`);
            }
        });

        await jail.set("require", requireCallback);

        const createArtifactCallback = new ivm.Callback((fileName, content, type) => {
            // 在这个回调函数的作用域内，`content` 是一个功能完备的 ivm.ExternalCopy
            try {
                let extractedContent;

                // 检查 .buffer 属性，这是最可靠的方式来识别二进制数据
                if (content && typeof content.buffer === "object" && content.buffer instanceof ArrayBuffer) {
                    extractedContent = Buffer.from(content.buffer);
                } else {
                    extractedContent = Buffer.from(String(content));
                }

                // 直接将处理好的、可序列化的对象存入数组
                processedRequests.push({
                    fileName: String(fileName), // 确保文件名也是原生类型
                    content: extractedContent, // content 现在是 Buffer
                    type: String(type), // 确保类型也是原生类型
                });
            } catch (err) {
                // 如果在回调内部处理失败，可以向沙箱内抛出错误，或通过 console.error 报告
                const errorMessage = `[Artifact Creation Callback Error] Failed to process artifact '${fileName}': ${err.message}`;
                // 使用 console.error 将错误信息传递出去
                context.evalClosureSync("console.error($0)", [errorMessage]);
            }
        });

        // 将 callback 注入到沙箱的全局作用域
        await jail.set("__createArtifact__", createArtifactCallback);

        await context.eval(`global.Uint8Array = Uint8Array`);

        // 3. 将代码包装在 async IIFE (立即执行的异步函数表达式) 中，以支持顶层 await
        const wrappedCode = `(async () => { ${code} })();`;

        // 4. 执行代码并等待 Promise 结果 (如果代码返回 Promise 的话)
        //const script = await isolate.compileScript(wrappedCode, { filename: "user_script.js" });
        //await script.run(context, { timeout, promise: true });
        await context.eval(wrappedCode, { timeout });
        // 5. 执行成功，整理日志并发送结果
        parentPort.postMessage({
            status: "success",
            data: {
                stdout: capturedLogs
                    .filter((it) => it.level === "log")
                    .map((it) => it.message)
                    .join("\n"),
                stderr: capturedLogs
                    .filter((it) => it.level !== "log")
                    .map((it) => it.message)
                    .join("\n"),
                artifactRequests: processedRequests,
            },
        });
    } catch (error) {
        // 6. 执行失败，整理日志和错误信息并发送
        const finalError: ExecutionError = {
            name: error.name || "WorkerError",
            message: error.message || "An unknown error occurred in the sandbox.",
            stack: error.stack,
        };

        parentPort.postMessage({
            status: "error",
            // 即使失败，也附上已捕获的日志，用于调试
            data: {
                stdout: capturedLogs
                    .filter((it) => it.level === "log")
                    .map((it) => it.message)
                    .join("\n"),
                stderr: capturedLogs
                    .filter((it) => it.level !== "log")
                    .map((it) => it.message)
                    .join("\n"),
                artifactRequests: processedRequests,
            },
            error: finalError,
        });
    } finally {
        // 7. 确保 isolate 实例总是被清理，防止内存泄漏
        if (isolate && !isolate.isDisposed) {
            isolate.dispose();
        }
    }
}

// 运行沙箱并捕获初始化阶段的任何未处理异常
executeInSandbox().catch((initError) => {
    parentPort.postMessage({
        status: "error",
        error: {
            name: "SandboxInitializationError",
            message: `沙箱初始化失败: ${initError.message}`,
            stack: initError.stack,
        },
    });
});
