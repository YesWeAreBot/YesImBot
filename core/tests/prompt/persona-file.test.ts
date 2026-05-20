import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensurePersonaFile } from "../../src/runtime/system-prompt";

const testDir = join(import.meta.dirname, "../../.test-tmp/persona-file");

beforeEach(async () => {
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("ensurePersonaFile", () => {
  it("creates PERSONA.md with the built-in Athena persona when the file is missing", async () => {
    const path = join(testDir, "PERSONA.md");
    const content = await ensurePersonaFile(path);

    expect(existsSync(path)).toBe(true);
    expect(content).toContain("你是 Athena，一个长期存在于聊天环境中的群友");
    expect(content).toContain("你更像群里一个熟悉的人");
    expect(content).toContain("有自己的判断、情绪、偏好和沉默权");
  });

  it("reads existing PERSONA.md without overwriting", async () => {
    const path = join(testDir, "PERSONA.md");
    const custom = "# PERSONA\n\nCustom persona content.";
    await writeFile(path, custom, "utf-8");

    const content = await ensurePersonaFile(path);

    expect(content).toBe(custom);
  });
});
