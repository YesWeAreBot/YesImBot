import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake-image-data")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

let sharedMockDb = {
  getData: vi.fn().mockReturnValue({}),
  set: vi.fn(),
  update: vi.fn(),
  commit: vi.fn(),
};

vi.mock("../src/utils", () => ({
  JsonDB: class MockJsonDB {
    constructor() {
      return sharedMockDb;
    }
  },
}));

vi.mock("koishi", () => {
  class Service {
    ctx: Record<string, unknown>;
    config: unknown;
    logger: Record<string, unknown>;

    constructor(ctx: Record<string, unknown>) {
      this.ctx = ctx;
      this.config = {};
      this.logger = (ctx.logger as (name: string) => Record<string, unknown>)("mock-service");
    }
  }

  return {
    Context: class {},
    Service,
  };
});

import { ImageCacheService } from "../src/services/image-cache/service";

describe("ImageCacheService data URL support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedMockDb = {
      getData: vi.fn().mockReturnValue({}),
      set: vi.fn(),
      update: vi.fn(),
      commit: vi.fn(),
    };
  });

  it("caches data URLs and returns the persisted content id", async () => {
    const fs = await import("node:fs/promises");
    const imageBytes = Buffer.from("png-bytes");
    const dataUrl = `data:image/png;base64,${imageBytes.toString("base64")}`;
    const contentHash = createHash("sha256").update(imageBytes).digest("hex");
    const contentId = contentHash.slice(0, 16);

    const ctx = {
      baseDir: "/test",
      http: {
        get: vi.fn(),
      },
      logger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      })),
    };

    const service = new ImageCacheService(ctx as never);
    await service.start();

    const result = await service.download(dataUrl);

    expect(result).toBe(contentId);
    expect(ctx.http.get).not.toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(`${contentId}.png`),
      imageBytes,
    );
    expect(sharedMockDb.set).toHaveBeenCalledWith(
      contentId,
      expect.objectContaining({
        id: contentId,
        url: dataUrl,
        mediaType: "image/png",
        ext: "png",
        size: imageBytes.byteLength,
      }),
    );
  });
});
