import path from "path";
import { Worker } from "worker_threads";

const code = `try {\n  const path = require('path');\n  console.log('path模块可用，示例:', path.join('a', 'b'));\n} catch (e) {\n  console.error('path模块不可用:', e.message);\n}`;

const workerPath = path.resolve(__dirname, "worker.js");

const worker = new Worker(workerPath, {
    workerData: {
        code,
        config: {
            timeout: 10000,
            allowedModules: ["axios"],
            allowedBuiltins: ["path", "os"],
            dependenciesPath: path.resolve(__dirname, "../external"),
        },
    },
});

worker.on("message", (result) => {
    console.log("Worker result:", result);
});

worker.on("error", (err) => {
    console.error("Worker error:", err);
});

worker.on("exit", (code) => {
    console.log("Worker exited with code", code);
});
