import { describe, expect, it } from "vitest";

import { python } from "./python-fixture";

describe("real CPython output protocol", () => {
    it("returns stdout, stderr and a final expression", async () => {
        const result = await python("import sys\nprint('hello')\nprint('warning', file=sys.stderr)\n6 * 7");
        expect(result).toMatchObject({ stdout: "hello\n42", stderr: "warning", artifacts: [] });
    });
    it("bounds both streams and counts Unicode code points", async () => {
        const result = await python("import sys\nprint('A😀B界')\nprint('123456', file=sys.stderr)\n'also discarded'", 3);
        expect(result.stdout).toBe("A😀B\n[Output truncated after 3 characters]");
        expect(result.stderr).toBe("123\n[Output truncated after 3 characters]");
    });
    it("snapshots text and binary artifacts with the existing API", async () => {
        const result = await python("__create_artifact__('text.txt', '你好')\n__create_artifact__('image.bin', bytes([0, 255]), 'image')");
        expect(result.artifacts.map((x: any) => [x.fileName, Buffer.from(x.content, "base64")])).toEqual([
            ["text.txt", Buffer.from("你好")],
            ["image.bin", Buffer.from([0, 255])],
        ]);
    });
    it("preserves syntax and execution errors", async () => {
        expect((await python("raise ValueError('expected')")).error).toMatchObject({ name: "ValueError", message: "expected" });
        expect((await python("if")).error.name).toBe("SyntaxError");
    });
    it("does not expose the JavaScript host bridge in native Python", async () => {
        expect((await python("import js\njs.process")).error.name).toBe("ModuleNotFoundError");
    });
    it("rejects artifact paths and oversized artifact lists", async () => {
        expect((await python("__create_artifact__('../secret', 'data')")).error.name).toBe("ValueError");
        expect((await python("for i in range(17):\n    __create_artifact__(str(i), b'')")).error.name).toBe("ValueError");
    });
});
