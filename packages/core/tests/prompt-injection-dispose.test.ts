import { test, expect } from "bun:test";

import { Context } from "koishi";

import { PromptService } from "../src/services/prompt/service";
import { Services } from "../src/shared/constants";

test("injection disposer removes own registration without removing a replacement", async () => {
    const ctx = new Context();
    ctx[Services.Logger] = { getLogger: () => ({ warn() {}, error() {} }) } as any;
    const service = new PromptService(ctx, { injectionPlaceholder: "injected", maxRenderDepth: 3 } as any);
    (service as any).registerDefaultInjections();
    const removeOld = service.inject("people", 10, () => "old");
    const removeNew = service.inject("people", 10, () => "new");
    removeOld();
    expect(await service.renderRaw("{{injected}}")).toContain("new");
    removeNew();
    expect(await service.renderRaw("{{injected}}")).toBe("");
});
