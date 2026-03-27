import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
  class MockContext {
    [key: string]: unknown;

    logger(_name: string) {
      return {
        level: 0,
        debug: vi.fn(),
      };
    }
  }

  class MockService<TConfig> {
    public config!: TConfig;
    public logger: { level?: number } = {};

    constructor(ctx: Record<string, unknown>, serviceId: string) {
      ctx[serviceId] = this;
    }
  }

  return {
    Context: MockContext,
    Service: MockService,
  };
});

import { Context } from "koishi";

import { ModelsService } from "../src/services/models/service";

const PERSISTED_OPENAI_KEY = "persisted-openai-key";
const ENV_OPENAI_KEY = "env-openai-key";
const persistedAuthJson = {
  openai: { type: "api_key", key: PERSISTED_OPENAI_KEY },
};

let originalOpenAiApiKey = process.env.OPENAI_API_KEY;

function setupAthenaAuthDir() {
  const tempRoot = mkdtempSync(join(tmpdir(), "athena-auth-service-test-"));
  const dataPath = join(tempRoot, ".athena");
  mkdirSync(dataPath, { recursive: true });
  const authPath = join(dataPath, "auth.json");
  writeFileSync(authPath, JSON.stringify(persistedAuthJson, null, 2));
  return { tempRoot, dataPath, authPath };
}

function cleanupTempRoot(tempRoot: string): void {
  rmSync(tempRoot, { recursive: true, force: true });
}

describe("ModelsService", () => {
  beforeEach(() => {
    originalOpenAiApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it("prefers OPENAI_API_KEY over persisted auth.json key at runtime", async () => {
    const { tempRoot, dataPath } = setupAthenaAuthDir();
    process.env.OPENAI_API_KEY = ENV_OPENAI_KEY;
    try {
      const ctx = new Context();
      const service = new ModelsService(ctx, { dataPath });

      await expect(service.modelRegistry.getApiKeyForProvider("openai")).resolves.toBe(
        ENV_OPENAI_KEY,
      );
      await expect(ctx["athena.models"].modelRegistry.getApiKeyForProvider("openai")).resolves.toBe(
        ENV_OPENAI_KEY,
      );
    } finally {
      if (originalOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalOpenAiApiKey;
      }
      cleanupTempRoot(tempRoot);
    }
  });

  it("keeps persisted credential object and auth.json unchanged when env override exists", async () => {
    const { tempRoot, dataPath, authPath } = setupAthenaAuthDir();
    process.env.OPENAI_API_KEY = ENV_OPENAI_KEY;
    try {
      const ctx = new Context();
      const service = new ModelsService(ctx, { dataPath });

      await expect(service.modelRegistry.getApiKeyForProvider("openai")).resolves.toBe(
        ENV_OPENAI_KEY,
      );
      expect(service.authStorage.get("openai")).toEqual({
        type: "api_key",
        key: PERSISTED_OPENAI_KEY,
      });

      const authJsonText = readFileSync(join(dataPath, "auth.json"), "utf8");
      expect(JSON.parse(authJsonText)).toEqual(persistedAuthJson);
      expect(readFileSync(authPath, "utf8")).toContain(PERSISTED_OPENAI_KEY);
    } finally {
      if (originalOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalOpenAiApiKey;
      }
      cleanupTempRoot(tempRoot);
    }
  });

  it("falls back to persisted auth.json key when OPENAI_API_KEY is not set", async () => {
    const { tempRoot, dataPath } = setupAthenaAuthDir();
    try {
      const ctx = new Context();
      const service = new ModelsService(ctx, { dataPath });

      await expect(service.modelRegistry.getApiKeyForProvider("openai")).resolves.toBe(
        PERSISTED_OPENAI_KEY,
      );
      expect(service.authStorage.get("openai")).toEqual({
        type: "api_key",
        key: PERSISTED_OPENAI_KEY,
      });
    } finally {
      if (originalOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalOpenAiApiKey;
      }
      cleanupTempRoot(tempRoot);
    }
  });

  it("registers itself on ctx and keeps auth.json under the provided .athena dataPath", () => {
    const { tempRoot, dataPath, authPath } = setupAthenaAuthDir();
    try {
      const ctx = new Context();
      const service = new ModelsService(ctx, { dataPath });

      expect(ctx["athena.models"]).toBe(service);
      expect(authPath).toBe(join(dataPath, "auth.json"));
      expect(existsSync(authPath)).toBe(true);
      expect(readFileSync(join(dataPath, "auth.json"), "utf8")).toContain(PERSISTED_OPENAI_KEY);
    } finally {
      cleanupTempRoot(tempRoot);
    }
  });
});
