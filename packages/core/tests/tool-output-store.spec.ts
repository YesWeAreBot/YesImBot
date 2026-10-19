import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ToolOutputStore, ToolOutputOwner } from "../src/extension/tool-output-store";

const dirs: string[] = [];
afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function store() {
    const dir = await mkdtemp(path.join(tmpdir(), "yesimbot-output-"));
    dirs.push(dir);
    return new ToolOutputStore(dir);
}
const owner: ToolOutputOwner = { instance: "instance-a", platform: "test", selfId: "bot", channelId: "group", channelType: "guild", generation: 0 };
describe("tool output immutable resources", () => {
    it("reclaims unreadable resources from previous boots before applying the quota", async () => {
        const old = await store();
        const receipt = await old.save('"old"', owner, () => {});
        const directory = dirs.at(-1)!;
        await Promise.all(Array.from({ length: 511 }, () => writeFile(path.join(directory, `${randomUUID()}.json`), "{}")));
        const current = new ToolOutputStore(directory);
        const saved = await current.save('"current"', owner, () => {});
        expect((await current.read(saved.uri, owner, 0, 100, () => {})).text).toBe('"current"');
        expect(await readdir(directory)).toHaveLength(1);
        await expect(current.read(receipt.uri, owner, 0, 100, () => {})).rejects.toThrow(/expired/i);
    });
    it("normalizes missing files and storage failures without returning server paths", async () => {
        const output = await store();
        const uri = `tool-output://${randomUUID()}`;
        await expect(output.read(uri, owner, 0, 100, () => {})).rejects.toThrow(/expired/i);
        const file = path.join(dirs.at(-1)!, "not-a-directory");
        await writeFile(file, "file");
        await expect(new ToolOutputStore(file).read(uri, owner, 0, 100, () => {})).rejects.toThrow(/^Tool output resource unavailable$/);
    });
    it("reconstructs long single lines and Unicode exactly in UTF-16 units", async () => {
        const output = await store();
        const source = JSON.stringify({ value: '🙂汉字\\"'.repeat(12000) });
        const receipt = await output.save(source, owner, () => {});
        let reconstructed = "",
            offset = 0;
        do {
            const page = await output.read(receipt.uri, owner, offset, 777, () => {});
            reconstructed += page.text;
            offset = page.nextOffset;
        } while (offset !== null);
        expect(reconstructed).toBe(source);
        expect(JSON.parse(reconstructed).value).toBe('🙂汉字\\"'.repeat(12000));
    });
    it("rejects cross-scope, cleared, malformed, and pre-reload resource references", async () => {
        const output = await store();
        const receipt = await output.save('"value"', owner, () => {});
        for (const field of ["instance", "platform", "selfId", "channelId", "channelType", "generation"]) {
            await expect(output.read(receipt.uri, { ...owner, [field]: "different" } as any, 0, 100, () => {})).rejects.toThrow(/scope|Invalid/);
        }
        await expect(output.read("tool-output://../secret", owner, 0, 100, () => {})).rejects.toThrow(/scope|Invalid/);
        const reloaded = new ToolOutputStore(dirs[dirs.length - 1]);
        await expect(reloaded.read(receipt.uri, owner, 0, 100, () => {})).rejects.toThrow(/expired/i);
    });
    it("rechecks authorization after disk IO and rejects invalid offsets", async () => {
        const output = await store();
        const receipt = await output.save('"value"', owner, () => {});
        let checks = 0;
        await expect(
            output.read(receipt.uri, owner, 0, 100, () => {
                if (++checks > 1) throw new Error("revoked");
            }),
        ).rejects.toThrow("revoked");
        await expect(output.read(receipt.uri, owner, -1, 100, () => {})).rejects.toThrow(/scope|Invalid/);
        await expect(output.read(receipt.uri, owner, 0, 8001, () => {})).rejects.toThrow(/scope|Invalid/);
        checks = 0;
        await expect(
            output.save('"value"', owner, () => {
                if (++checks > 1) throw new Error("cleared");
            }),
        ).rejects.toThrow("cleared");
    });
});
