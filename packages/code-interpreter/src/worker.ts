import ivm from "isolated-vm";
import path from "path";
import { parentPort, workerData } from "worker_threads";

async function executeInSandbox() {
    const { code, config } = workerData;
    const { allowedBuiltins, allowedModules, dependenciesPath, timeout, memoryLimit } = config;

    const capturedLogs = [];
    const isolate = new ivm.Isolate({ memoryLimit: memoryLimit });
    const context = await isolate.createContext();
    const jail = context.global;

    // 设置一个全局对象，防止沙箱访问到外部的 global
    await jail.set("global", jail.derefInto());

    // 1. 实现 console 重定向 (使用 evalClosure)
    const logCallback = new ivm.Reference((level, ...args) => {
        const message = args
            .map((arg) => {
                if (arg instanceof Error) {
                    return arg.stack;
                }
                return typeof arg === "string" ? arg : JSON.stringify(arg, null, 2);
            })
            .join(" ");
        capturedLogs.push({ level, message });
    });

    await context.evalClosure(
        `
        global.console = {
            log: (...args) => $0.applyIgnored(undefined, ['log', ...args]),
            error: (...args) => $0.applyIgnored(undefined, ['error', ...args]),
            warn: (...args) => $0.applyIgnored(undefined, ['warn', ...args]),
        };`,
        [logCallback]
    );

    // 2. 实现安全的 require 函数
    const allowedSet = new Set([...allowedBuiltins, ...allowedModules]);
    const hostRequire = (moduleName) => {
        if (!allowedSet.has(moduleName)) {
            throw new Error(`不允许导入模块 '${moduleName}'。`);
        }
        if (allowedBuiltins.includes(moduleName)) {
            return require(moduleName);
        }
        return require(path.join(dependenciesPath, "node_modules", moduleName));
    };

    await jail.set(
        "require",
        new ivm.Callback((moduleName) => {
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
        })
    );

    try {
        // 3. 执行代码 (包装在 async IIFE 中)
        const wrappedCode = `
            (async () => {
                ${code}
            })();
        `;

        await context.eval(wrappedCode, { timeout });

        parentPort.postMessage({
            status: "success",
            data: { console: capturedLogs },
        });
    } catch (error) {
        parentPort.postMessage({
            status: "error",
            error: {
                message: error.stack ? error.stack.split("\n")[0] : error.message,
                console: capturedLogs,
            },
        });
    } finally {
        if (!isolate.isDisposed) {
            isolate.dispose();
        }
    }
}

executeInSandbox().catch((error) => {
    parentPort.postMessage({
        status: "error",
        error: { message: `沙箱初始化失败: ${error.message}`, console: [] },
    });
});
