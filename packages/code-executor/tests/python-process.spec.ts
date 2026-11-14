import { describe, expect, it } from "vitest";

import { runProcess } from "../src/executors/python/process";

describe("Python process supervisor", () => {
    it("reports a missing runtime instead of hanging on spawn failure", async () => {
        await expect(runProcess("/does/not/exist", [], "", new AbortController().signal)).rejects.toThrow("ENOENT");
    });
    it("kills descendants that inherit output pipes after their parent exits", async () => {
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(new Error("descendant survived")), 2000);
        try {
            const output = await runProcess(
                "/usr/bin/python3",
                ["-I", "-c", "import subprocess; subprocess.Popen(['/usr/bin/python3', '-c', 'import time; time.sleep(60)']); print('done')"],
                "",
                deadline.signal,
            );
            expect(output.trim()).toBe("done");
        } finally {
            clearTimeout(timer);
        }
    });
    it("rejects already aborted work before creating a process", () => {
        const controller = new AbortController();
        controller.abort(new Error("cancelled before spawn"));
        expect(() => runProcess("/usr/bin/python3", [], "", controller.signal)).toThrow("cancelled before spawn");
    });
});
