import path from "path";
import { NodeVM } from "vm2";
import { parentPort, workerData } from "worker_threads";

async function executeInSandbox() {
    const { code, config } = workerData;

    const wrappedCode = `(async () => { ${code} })();`;

    const capturedLogs = [];
    const nodeVM = new NodeVM({
        timeout: config.timeout,
        console: "redirect",
        sandbox: {},
        require: {
            external: {
                modules: config.allowedModules,
                resolve: (moduleName) => path.join(config.dependenciesPath, "node_modules", moduleName),
            },
            builtin: config.allowedBuiltins,
            root: "./",
            mock: {
                fs: {},
                child_process: {},
            },
        },
        wrapper: "none",
    });

    nodeVM.on("console.log", (...args) => capturedLogs.push({ level: "log", message: args.join(" ") }));
    nodeVM.on("console.error", (...args) => capturedLogs.push({ level: "error", message: args.join(" ") }));
    nodeVM.on("console.warn", (...args) => capturedLogs.push({ level: "warn", message: args.join(" ") }));

    try {
        const executionResult = await nodeVM.run(wrappedCode, "vm.js");
        const finalResult = {
            status: "success",
            data: {
                result: executionResult,
                console: capturedLogs,
            },
        };
        parentPort.postMessage(finalResult);
    } catch (error) {
        const finalResult = {
            status: "error",
            error: {
                message: error.message,
                console: capturedLogs,
            },
        };
        parentPort.postMessage(finalResult);
    }
}

executeInSandbox();