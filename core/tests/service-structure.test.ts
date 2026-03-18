import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

const SERVICES_DIR = join(__dirname, "../src/services");

describe("Service module boundaries", () => {
  const topLevelDirs = readdirSync(SERVICES_DIR).filter((entry) =>
    statSync(join(SERVICES_DIR, entry)).isDirectory(),
  );

  it("every top-level services/ directory has a service.ts file", () => {
    const missing: string[] = [];
    for (const dir of topLevelDirs) {
      const servicePath = join(SERVICES_DIR, dir, "service.ts");
      if (!existsSync(servicePath)) {
        missing.push(dir);
      }
    }
    expect(missing).toEqual([]);
  });

  it("services/ does not contain generic bucket directories", () => {
    const bucketNames = ["shared", "runtime", "utils", "helpers", "common", "lib"];
    const found = topLevelDirs.filter((dir) => bucketNames.includes(dir));
    expect(found).toEqual([]);
  });

  it("HookType enum contains only Tool and Agent", async () => {
    const { HookType } = await import("../src/services/hook/types");
    const values = Object.values(HookType);
    expect(values).toContain("tool");
    expect(values).toContain("agent");
    expect(values).not.toContain("message");
    expect(values).toHaveLength(2);
  });

  it("shared/ and runtime/ exist at core/src/ level", () => {
    const srcDir = join(__dirname, "../src");
    expect(existsSync(join(srcDir, "shared"))).toBe(true);
    expect(existsSync(join(srcDir, "runtime"))).toBe(true);
    expect(existsSync(join(srcDir, "shared/context-factory.ts"))).toBe(true);
    expect(existsSync(join(srcDir, "shared/types.ts"))).toBe(true);
    expect(existsSync(join(srcDir, "runtime/contracts.ts"))).toBe(true);
    expect(existsSync(join(srcDir, "runtime/adapters.ts"))).toBe(true);
  });
});
