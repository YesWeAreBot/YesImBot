import { parentPort, workerData } from "worker_threads";
import { NodeVM } from "vm2";
import path from "path";

async function executeInSandbox() {
    const { code, config } = workerData;
    const { allowedBuiltins, allowedModules, dependenciesPath, timeout } = config;

    const capturedLogs = [];

    const vm = new NodeVM({
        timeout: timeout,
        console: "redirect",
        sandbox: {},
        require: {
            // external.resolve 用于解析允许的外部模块
            external: {
                modules: allowedModules,
                resolve: (moduleName) => path.join(dependenciesPath, "node_modules", moduleName),
            },
            builtin: allowedBuiltins,
            mock: {
                fs: {},
                child_process: {},
            },
        },
        // 包装代码以支持顶层 await
        wrapper: "commonjs",
        sourceExtensions: ["js"],
    });

    // 重定向所有 console 输出
    vm.on("console.log", (...args) => capturedLogs.push({ level: "log", message: args.join(" ") }));
    vm.on("console.error", (...args) => capturedLogs.push({ level: "error", message: args.join(" ") }));
    vm.on("console.warn", (...args) => capturedLogs.push({ level: "warn", message: args.join(" ") }));

    try {
        // 使用 module.exports 来获取返回值，以防代码中显式 `return`
        const resultInVm = vm.run(
            `module.exports = (async () => {
                ${code}
            })();`,
            path.join(dependenciesPath, "sandbox.js")
        );

        // 等待异步代码执行完成
        await resultInVm;

        parentPort.postMessage({
            status: "success",
            // 返回值始终是 console 日志
            data: { console: capturedLogs },
        });
    } catch (error) {
        // 将错误信息和已捕获的日志一起发送回主线程
        parentPort.postMessage({
            status: "error",
            error: { message: error.message, console: capturedLogs },
        });
    }
}

executeInSandbox();
