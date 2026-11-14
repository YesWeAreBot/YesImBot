import { spawn } from "node:child_process";

// Bound IPC even if user code bypasses the Python output collectors.
export function runProcess(command: string, args: string[], input: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { detached: true, env: {}, stdio: ["pipe", "pipe", "pipe"] });
        const output: Buffer[] = [];
        const diagnostics: Buffer[] = [];
        let bytes = 0;
        let diagnosticBytes = 0;
        let failure: Error | undefined;
        const kill = () => {
            if (child.pid) {
                try {
                    process.kill(-child.pid, "SIGKILL");
                } catch {}
            }
        };
        const abort = () => {
            failure = signal.reason instanceof Error ? signal.reason : new Error("Python execution cancelled");
            kill();
        };
        signal.addEventListener("abort", abort, { once: true });
        child.stdout.on("data", (data: Buffer) => {
            bytes += data.length;
            if (bytes > 24 * 1024 * 1024) {
                failure = new Error("Python sandbox response exceeds 24 MiB");
                kill();
            } else output.push(data);
        });
        child.stderr.on("data", (data: Buffer) => {
            if (diagnosticBytes < 16384) diagnostics.push(data.subarray(0, 16384 - diagnosticBytes));
            diagnosticBytes += data.length;
        });
        child.on("error", (error) => {
            failure = error;
        });
        // Descendants can inherit the IPC pipes after the leader exits. Stop them
        // before waiting for `close`, which waits for those same pipes to close.
        child.on("exit", kill);
        child.stdin.on("error", () => {});
        child.on("close", (code, terminated) => {
            signal.removeEventListener("abort", abort);
            // A successful leader must not leave descendants holding the namespace.
            kill();
            if (failure) reject(failure);
            else if (code !== 0) reject(new Error(`Python sandbox failed (${terminated ?? code}): ${Buffer.concat(diagnostics).toString()}`));
            else resolve(Buffer.concat(output).toString());
        });
        if (signal.aborted) abort();
        child.stdin.end(input);
    });
}
