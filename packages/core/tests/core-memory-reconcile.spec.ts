import { mkdtemp, writeFile, unlink, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Context } from "koishi";
import { expect, it } from "vitest";

import { MemoryService } from "../src/memory/service";
import { MustacheRenderer } from "../src/prompt/renderer";

const text = (label: string, content: string) => `---\nlabel: ${label}\ntitle: Persona\n---\n${content}`;

it("reconciles deleted, recreated and atomically replaced core files without reviving defaults", async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "yib-memory-"));
    const file = path.join(directory, "persona.md");
    await writeFile(file, text("persona", "old"));
    const ctx = new Context();
    const service = new MemoryService(ctx, { coreMemoryPath: directory } as any, { getLogger: () => ({ warn() {}, error() {}, debug() {} }) } as any);
    t.onTestFinished(async () => {
        service.stop();
        await ctx.stop();
        await rm(directory, { recursive: true, force: true });
    });
    const render = () => new MustacheRenderer().render("{{#blocks}}{{content}}{{/blocks}}", { blocks: service.getMemoryBlocksForRendering() });
    await service.start();
    expect(render()).toBe("old");
    await unlink(file);
    await expect.poll(() => service.getMemoryBlocksForRendering(), { timeout: 3000 }).toEqual([]);
    expect(render()).not.toContain("old");
    await writeFile(file, text("persona", "recreated"));
    await expect.poll(() => service.getMemoryBlocksForRendering()[0]?.content).toBe("recreated");
    await writeFile(path.join(directory, "replacement.tmp"), text("new-label", "replaced"));
    await rename(path.join(directory, "replacement.tmp"), file);
    await expect.poll(() => service.getMemoryBlocksForRendering().map((b) => [b.label, b.content])).toEqual([["new-label", "replaced"]]);
    expect(render()).toBe("replaced");
    await service.loadCoreMemoryBlocks();
    expect(service.getMemoryBlocksForRendering()).toHaveLength(1);
});
