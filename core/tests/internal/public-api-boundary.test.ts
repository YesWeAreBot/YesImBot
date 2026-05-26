import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function readCore(path: string): string {
  return readFileSync(join(process.cwd(), "src", path), "utf-8");
}

function internalServiceLookup(name: "session" | "bot" | "runtime"): string {
  return `ctx["yesimbot.${name}"]`;
}

function internalPluginLoad(name: "Session" | "AthenaBot" | "Runtime"): string {
  return `ctx.plugin(${name}Service`;
}

describe("Core public/internal API boundary", () => {
  it("root apply loads only public services, optional plugins, and Core App", () => {
    const source = readCore("index.ts");

    expect(source).toContain("ctx.plugin(ModelService");
    expect(source).toContain("ctx.plugin(ExtensionService");
    expect(source).toContain("ctx.plugin(CoreApp");
    expect(source).not.toContain(internalPluginLoad("Session"));
    expect(source).not.toContain(internalPluginLoad("AthenaBot"));
    expect(source).not.toContain(internalPluginLoad("Runtime"));
  });

  it("internal runtime files do not depend on internal Koishi service lookups", () => {
    const controller = readCore("internal/runtime/controller.ts");
    const botModule = readCore("internal/bot/module.ts");

    expect(controller).not.toContain(internalServiceLookup("session"));
    expect(controller).not.toContain(internalServiceLookup("bot"));
    expect(controller).not.toContain(internalServiceLookup("runtime"));
    expect(botModule).not.toContain(internalServiceLookup("session"));
  });

  it("removes obsolete compatibility source directories", () => {
    const root = join(process.cwd(), "src");

    expect(existsSync(join(root, "bot"))).toBe(false);
    expect(existsSync(join(root, "runtime"))).toBe(false);
    expect(existsSync(join(root, "services", "session"))).toBe(false);
  });

  it("keeps the public extension service under services/extension", () => {
    const source = readCore("services/extension/service.ts");

    expect(source).toContain('super(ctx, "yesimbot.extension")');
    expect(source).not.toContain("extends RuntimeController");
  });
});
