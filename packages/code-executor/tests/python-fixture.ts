import { runProcess } from "../src/executors/python/process";
import { PYTHON_RUNNER } from "../src/executors/python/runner";

export async function python(code: string, limit = 1024, signal = new AbortController().signal) {
    // Protocol tests execute trusted fixture code directly; this is not a sandbox.
    return JSON.parse(await runProcess("/usr/bin/python3", ["-I", "-c", PYTHON_RUNNER], JSON.stringify({ code, limit, memory: 512 * 1024 * 1024 }), signal));
}
