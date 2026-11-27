import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { c as createTar } from "tar";
import { expect, it, vi } from "vitest";

import { BinaryInstaller } from "../src/BinaryInstaller";
import { CommandResolver } from "../src/CommandResolver";
import { FileManager } from "../src/FileManager";
import { MCPManager } from "../src/MCPManager";
import { SystemUtils } from "../src/SystemUtils";

const logger: any = { info() {}, warn() {}, error() {}, debug() {}, success() {} };
it("does not inherit host secrets and applies runtime options to aliases and direct commands", async () => {
    const previous = process.env.AUDIT_PRIVATE_TOKEN;
    process.env.AUDIT_PRIVATE_TOKEN = "must-not-leak";
    try {
        const resolver = new CommandResolver(
            logger,
            { checkCommand: () => true } as any,
            { uvSettings: { args: ["--offline"] }, bunSettings: { args: ["--no-install"] } } as any,
        );
        const [uv, uvArgs, env] = await resolver.resolveCommand("uvx", ["tool"], true, { EXPLICIT_TOKEN: "scoped" });
        expect(uv).toBe("uv");
        expect(uvArgs).toEqual(["--offline", "tool", "run", "tool"]);
        expect(env.AUDIT_PRIVATE_TOKEN).toBeUndefined();
        expect(env.EXPLICIT_TOKEN).toBe("scoped");
        expect((await resolver.resolveCommand("uv", ["run"]))[1]).toEqual(["--offline", "run"]);
        expect((await resolver.resolveCommand("npx", ["tool"]))[1]).toEqual(["--no-install", "x", "tool"]);
        expect((await resolver.resolveCommand("npx", ["tool"], false))[1]).toEqual(["tool"]);
    } finally {
        if (previous === undefined) delete process.env.AUDIT_PRIVATE_TOKEN;
        else process.env.AUDIT_PRIVATE_TOKEN = previous;
    }
});
it("validates exact MCP composite input contracts and preserves structured outputs", async () => {
    const tools: any[] = [];
    const registered = new Map<string, any>([["send_message", { core: true }]]);
    const toolService: any = {
        getTool: (name: string) => registered.get(name),
        registerTool: (tool: any) => {
            tools.push(tool);
            registered.set(tool.name, tool);
            return () => registered.delete(tool.name);
        },
    };
    const manager = new MCPManager({} as any, logger, {} as any, toolService, { timeout: 1000 } as any);
    const schema: any = {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: {
            value: {
                anyOf: [
                    { type: "integer", minimum: 1 },
                    { type: "string", minLength: 2, pattern: "^[a-z]+$" },
                ],
            },
        },
    };
    const content = [
        { type: "text", text: "text" },
        { type: "image", data: "abc", mimeType: "image/png" },
    ];
    const callTool = vi.fn(async () => ({ content, structuredContent: { value: 1 } }));
    const client: any = {
        listTools: async () => ({
            tools: [
                { name: "send_message", inputSchema: { type: "object" } },
                { name: "remote", inputSchema: schema },
            ],
        }),
        callTool,
    };
    await (manager as any).registerTools(client, "server");
    expect(tools).toHaveLength(1);
    expect(registered.get("send_message")).toEqual({ core: true });
    expect(tools[0].parametersJSONSchema).toEqual(schema);
    for (const input of [{ value: 0 }, { value: "A" }, { value: "ok", extra: 1 }, {}]) {
        expect(() => tools[0].parameters(input)).toThrow("JSON Schema");
    }
    const result = await tools[0].execute({ value: "ok", toolContext: {}, session: {} });
    expect(result.result).toEqual({ content, structuredContent: { value: 1 }, isError: false });
    expect(callTool.mock.calls[0][0]).toEqual({ name: "remote", arguments: { value: "ok" } });
    await manager.cleanup();
});
it("checks download digest before extraction", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mcp-digest-"));
    try {
        const bytes = Buffer.from("archive fixture");
        const files = new FileManager(logger, { get: async () => Readable.from([bytes]) });
        const digest = createHash("sha256").update(bytes).digest("hex");
        await files.downloadFile("https://example.invalid/archive", path.join(dir, "ok"), "fixture", digest);
        expect(await readFile(path.join(dir, "ok"))).toEqual(bytes);
        await expect(files.downloadFile("https://example.invalid/archive", path.join(dir, "bad"), "fixture", "0".repeat(64))).rejects.toThrow("SHA-256");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
it("selects Unix UV tar.gz layout and normalizes Bun tags; refuses latest or unpinned downloads", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mcp-install-"));
    try {
        const system = new SystemUtils(logger);
        const mapping = system.getPlatformMapping()!;
        const folder = `uv-${mapping.uvArch}-${mapping.uvPlatform}`;
        const source = path.join(dir, "fixtures");
        await mkdir(path.join(source, folder), { recursive: true });
        await writeFile(path.join(source, folder, "uv"), "fixture");
        const tarPath = path.join(dir, "uv.tar.gz");
        await createTar({ cwd: source, file: tarPath, gzip: true }, [folder]);
        const files = new FileManager(logger, {} as any);
        const url = vi.fn(() => "https://example.invalid/runtime");
        const manager = new BinaryInstaller(
            logger,
            system,
            {
                ...files,
                downloadFile: vi.fn(async (_url, dest) => writeFile(dest, await readFile(tarPath))),
                extractTarGz: files.extractTarGz.bind(files),
                extractZip: vi.fn(),
                cleanup: files.cleanup.bind(files),
            } as any,
            { buildDownloadUrl: url, getLatestVersion: vi.fn() } as any,
            dir,
            path.join(dir, "cache"),
        );
        await mkdir(path.join(dir, "cache"));
        expect(await manager.installUV("latest", undefined, "0".repeat(64))).toBeNull();
        expect(await manager.installBun("1.2.3")).toBeNull();
        const installed = await manager.installUV("0.9.0", undefined, "0".repeat(64));
        expect(installed).toBe(path.join(dir, "mcp-ext", "bin", "uv"));
        expect(url.mock.calls[0][3]).toBe(`${folder}.tar.gz`);
        expect(await readFile(installed!, "utf8")).toBe("fixture");
        await manager.installBun("1.2.3", undefined, "0".repeat(64));
        expect(url.mock.calls[1][2]).toBe("bun-v1.2.3");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

it("retains registered names and skips one invalid schema without dropping other tools", async () => {
    const registerTool = vi.fn<(...args: any[]) => void>();
    const toolService = { getTool: () => undefined, hasRegisteredTool: (name: string) => name === "reserved", registerTool };
    const manager = new MCPManager({} as any, logger, {} as any, toolService as any, { timeout: 1000 } as any);
    const client = {
        listTools: async () => ({
            tools: [
                { name: "reserved", inputSchema: { type: "object" } },
                { name: "unsupported", inputSchema: { type: "object", properties: { bad: { type: "string", format: "unknown-custom-format" } } } },
                { name: "formatted", inputSchema: { type: "object", properties: { email: { type: "string", format: "email" } } } },
            ],
        }),
    };
    await (manager as any).registerTools(client, "fixture");
    const [definition] = registerTool.mock.calls[0];
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(definition.name).toBe("formatted");
    expect(definition.parameters({ email: "user@example.test" })).toEqual({ email: "user@example.test" });
    expect(() => definition.parameters({ email: "invalid" })).toThrow("JSON Schema");
    await manager.cleanup();
});
