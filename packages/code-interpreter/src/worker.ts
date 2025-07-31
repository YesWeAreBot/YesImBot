import { parentPort, workerData } from "worker_threads";
import ivm from "isolated-vm";
import path from "path";

async function executeInSandbox() {
    const { code, config } = workerData;
    const { allowedBuiltins, allowedModules, dependenciesPath, timeout, memoryLimit } = config;

    const capturedLogs = [];
    const isolate = new ivm.Isolate({ memoryLimit: memoryLimit });
    const context = await isolate.createContext();
    const jail = context.global;

    // 设置一个全局对象，防止沙箱访问到外部的 global
    await jail.set("global", jail.derefInto());

    // 1. 实现 console 重定向
    // 我们将创建一个代理函数，当沙箱内调用它时，会把日志存入 capturedLogs
    const logCallback = new ivm.Reference((level, ...args) => {
        const message = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
        capturedLogs.push({ level, message });
    });

    // 在沙箱内创建一个 console 对象，并将我们的代理函数绑定到它的方法上
    // 使用 evalClosure 将 logCallback作为参数$0传入
    await context.evalClosure(
        `
        global.console = {
            log: (...args) => $0.applyIgnored(undefined, ['log', ...args]),
            error: (...args) => $0.applyIgnored(undefined, ['error', ...args]),
            warn: (...args) => $0.applyIgnored(undefined, ['warn', ...args]),
        };`,
        [logCallback] // 此数组中的元素将作为 $0, $1, ... 传递给代码
    );

    // 2. 实现安全的 require 函数
    const allowedSet = new Set([...allowedBuiltins, ...allowedModules]);
    const hostRequire = (moduleName) => {
        // 再次校验，作为深度防御
        if (!allowedSet.has(moduleName)) {
            throw new Error(`不允许导入模块 '${moduleName}'。`);
        }
        // 根据模块类型决定加载路径
        if (allowedBuiltins.includes(moduleName)) {
            return require(moduleName);
        }
        return require(path.join(dependenciesPath, "node_modules", moduleName));
    };

    // 使用 ivm.Callback 创建一个可以在沙箱内被调用的 require 函数
    await jail.set(
        "require",
        new ivm.Callback((moduleName) => {
            try {
                const mod = hostRequire(moduleName);
                // 使用 ExternalCopy 将模块的导出安全地复制到沙箱中
                // 这可以处理函数、对象等多种导出类型
                return new ivm.ExternalCopy(mod).copyInto();
            } catch (error) {
                // 将 require 内部的错误抛出到沙箱，让用户的代码可以捕获它
                throw new Error(`加载模块 '${moduleName}' 失败: ${error.message}`);
            }
        })
    );

    try {
        // 3. 编译和执行代码
        // 使用 compileModule 可以天然支持顶层 await
        const module = await isolate.compileModule(code, {
            filename: "sandbox.js",
        });

        // 使用 evaluate() 执行模块，它会返回一个 Promise，自动处理异步代码
        await module.evaluate({ timeout });

        parentPort.postMessage({
            status: "success",
            data: { console: capturedLogs },
        });
    } catch (error) {
        // 捕获编译或运行时错误（包括超时）
        parentPort.postMessage({
            status: "error",
            error: {
                message: error.message.replace(/(\r\n|\n|\r)/gm, " "), // 清理错误信息中的换行符
                console: capturedLogs,
            },
        });
    } finally {
        // 4. 清理资源
        if (!isolate.isDisposed) {
            isolate.dispose();
        }
    }
}

executeInSandbox().catch((error) => {
    // 捕获沙箱设置阶段的致命错误
    parentPort.postMessage({
        status: "error",
        error: { message: `沙箱初始化失败: ${error.message}`, console: [] },
    });
});
