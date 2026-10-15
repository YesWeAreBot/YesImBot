import { Context } from "koishi";
import { test, expect } from "vitest";

import type { Config } from "../src/config";
import { PromptService } from "../src/prompt/service";
import { loggingStub, stubYesImBot } from "./helpers/yesimbot";

test("injection disposer removes own registration without removing a replacement", async () => {
    const logger = { warn() {}, error() {} };
    const ctx = new Context();
    Object.assign(ctx, { yesimbot: stubYesImBot({ logging: { getLogger: () => logger } }) });
    // 部分配置桩：其余字段由 schema 默认值补齐。
    const service = new PromptService(ctx, { injectionPlaceholder: "injected", maxRenderDepth: 3 } as unknown as Config, loggingStub(logger));
    (service as any).registerDefaultInjections();
    const removeOld = service.inject("people", 10, () => "old");
    const removeNew = service.inject("people", 10, () => "new");
    removeOld();
    expect(await service.renderRaw("{{injected}}")).toContain("new");
    removeNew();
    expect(await service.renderRaw("{{injected}}")).toBe("");
});
