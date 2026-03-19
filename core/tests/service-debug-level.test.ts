import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readSource(relativePathFromTestsDir: string): string {
  return readFileSync(resolve(__dirname, relativePathFromTestsDir), "utf8");
}

function expectPluginConfigHasDebugLevel(source: string, pluginName: string): void {
  const pluginPattern = new RegExp(
    `ctx\\.plugin\\(${pluginName}, \\{[\\s\\S]*?debugLevel: config\\.debugLevel`,
  );
  expect(source).toMatch(pluginPattern);
}

describe("service debug level propagation regression", () => {
  it("apply passes debugLevel into every in-scope service plugin registration", () => {
    const source = readSource("../src/index.ts");

    expect(source).toContain("ctx.plugin(ImageCacheService, { debugLevel: config.debugLevel })");
    expect(source).toContain("ctx.plugin(FormatterService, { debugLevel: config.debugLevel })");
    expect(source).toContain(
      "ctx.plugin(ModelService, { concurrency: config.concurrency, debugLevel: config.debugLevel })",
    );
    expectPluginConfigHasDebugLevel(source, "HookService");

    expectPluginConfigHasDebugLevel(source, "HorizonService");
    expectPluginConfigHasDebugLevel(source, "PluginService");
    expectPluginConfigHasDebugLevel(source, "PromptService");
    expectPluginConfigHasDebugLevel(source, "PersonaService");
    expectPluginConfigHasDebugLevel(source, "SkillRegistry");
    expectPluginConfigHasDebugLevel(source, "AgentCore");
    expectPluginConfigHasDebugLevel(source, "MemoryAgentService");
    expectPluginConfigHasDebugLevel(source, "ArousalService");
  });

  it("in-scope service constructors set logger.level to config.debugLevel or 2", () => {
    const expectedPatterns: Array<{ path: string; pattern: RegExp }> = [
      {
        path: "../src/services/agent/service.ts",
        pattern: /this\.logger\.level = config\.debugLevel \?\? 2/,
      },
      {
        path: "../src/services/hook/service.ts",
        pattern:
          /this\.logger\.level = this\.config\.debugLevel \?\? this\.config\.logLevel \?\? 2/,
      },
      {
        path: "../src/services/horizon/service.ts",
        pattern: /this\.logger\.level = config\.debugLevel \?\? 2/,
      },
      {
        path: "../src/services/model/service.ts",
        pattern: /this\.logger\.level = config\.debugLevel \?\? 2/,
      },
      {
        path: "../src/services/plugin/service.ts",
        pattern: /this\.logger\.level = config\.debugLevel \?\? 2/,
      },
      {
        path: "../src/services/prompt/service.ts",
        pattern: /this\.logger\.level = config\.debugLevel \?\? 2/,
      },
      {
        path: "../src/services/skill/service.ts",
        pattern: /this\.logger\.level = config\.debugLevel \?\? 2/,
      },
      {
        path: "../src/services/arousal/service.ts",
        pattern: /this\.logger\.level = config\.debugLevel \?\? 2/,
      },
      {
        path: "../src/services/memory-agent/service.ts",
        pattern: /this\.logger\.level = config\.debugLevel \?\? 2/,
      },
      {
        path: "../src/services/role/service.ts",
        pattern: /this\.logger\.level = config\.debugLevel \?\? 2/,
      },
      {
        path: "../src/services/formatter/service.ts",
        pattern: /this\.logger\.level = this\.config\.debugLevel \?\? 2/,
      },
      {
        path: "../src/services/image-cache/service.ts",
        pattern: /this\.logger\.level = this\.config\.debugLevel \?\? 2/,
      },
    ];

    for (const check of expectedPatterns) {
      const source = readSource(check.path);
      expect(source).toMatch(check.pattern);
    }
  });
});
