import { afterEach, expect, it, vi } from "vitest";

import { ErrorReporter } from "../src/shared/errors";

afterEach(() => vi.unstubAllGlobals());

const logger = { warn() {}, error() {}, info() {}, debug() {} } as any;

for (const includeSensitiveInfo of [false, true]) {
    it.each([true, false, undefined])(`honors includeSystemInfo=%s in ${includeSensitiveInfo ? "detailed" : "summary"} uploads`, async (includeSystemInfo) => {
        const realProcess = process;
        vi.stubGlobal(
            "process",
            new Proxy(realProcess, {
                get(target, key, receiver) {
                    if (key === "version") return "v22.99.1";
                    if (key === "platform") return "fixture-os";
                    if (key === "arch") return "fixture-arch";
                    if (key === "env") return { PRIVATE_FIXTURE: "private-environment-marker" };
                    if (key === "cwd") return () => "/private-working-directory-marker";
                    return Reflect.get(target, key, receiver);
                },
            }),
        );
        const dumps: string[] = [];
        vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
            dumps.push(String((init.body as FormData).get("c")));
            return new Response(JSON.stringify({ url: "https://reports.invalid/result" }));
        });
        const reporter = new ErrorReporter(
            {
                enabled: true,
                pasteServiceUrl: "https://reports.invalid/",
                includeSensitiveInfo,
                ...(includeSystemInfo === undefined ? {} : { includeSystemInfo }),
            },
            logger,
        );

        expect(await reporter.report({ errorId: "runtime-report", error: new Error("fixture failure") })).toBe("https://reports.invalid/result");
        expect(dumps).toHaveLength(1);
        const payload = JSON.parse(dumps[0].match(/```json\n([\s\S]*?)\n```/)![1]);
        const included = includeSystemInfo !== false;
        expect(Object.hasOwn(payload, "systemInfo")).toBe(included);
        expect(payload.systemInfo).toEqual(included ? { nodeVersion: "v22.99.1", platform: "fixture-os", architecture: "fixture-arch" } : undefined);
        for (const value of ["v22.99.1", "fixture-os", "fixture-arch"]) expect(dumps[0].includes(value)).toBe(included);
        expect(dumps[0]).not.toContain("private-environment-marker");
        expect(dumps[0]).not.toContain("private-working-directory-marker");
    });
}
