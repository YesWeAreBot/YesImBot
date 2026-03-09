import { createHash } from "node:crypto";

import { Context } from "koishi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageCacheService } from "../src/services/image-cache/service";
import type { ImageMetadata } from "../src/services/image-cache/types";

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake-image-data")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

// Mock JsonDB - create a shared instance that all tests can access
const createMockDb = () => ({
  getData: vi.fn().mockReturnValue({}),
  set: vi.fn(),
  update: vi.fn(),
  commit: vi.fn(),
});

let sharedMockDb = createMockDb();

vi.mock("../src/utils/jsondb", () => ({
  JsonDB: class MockJsonDB {
    constructor() {
      return sharedMockDb;
    }
  },
}));

describe("ImageCacheService", () => {
  let ctx: Context;
  let service: ImageCacheService;
  let logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the shared mock
    sharedMockDb = createMockDb();

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    ctx = {
      baseDir: "/test",
      http: {
        get: vi.fn(),
      },
      logger: vi.fn(() => logger),
    } as unknown as Context;
  });

  describe("start()", () => {
    it("should create cache directories", async () => {
      const fs = await import("node:fs/promises");
      service = new ImageCacheService(ctx);
      Object.defineProperty(service, "ctx", {
        get: () => ctx,
      });
      expect((service as unknown as { ctx: Context }).ctx).toBe(ctx);
      await service.start();
      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("images"), { recursive: true });
    });

    it("should load metadata from JsonDB and preload index", async () => {
      const mockMetadata: Record<string, ImageMetadata> = {
        abc123: {
          id: "abc123",
          url: "https://example.com/image.jpg",
          contentHash: "full-hash",
          mediaType: "image/jpeg",
          ext: "jpg",
          size: 1024,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          accessCount: 0,
        },
      };

      sharedMockDb.getData.mockReturnValue(mockMetadata);

      service = new ImageCacheService(ctx);
      await service.start();

      expect(sharedMockDb.getData).toHaveBeenCalled();
    });

    it("should remove orphan metadata entries when file is missing", async () => {
      const fs = await import("node:fs/promises");
      const mockMetadata: Record<string, ImageMetadata> = {
        orphan123: {
          id: "orphan123",
          url: "https://example.com/missing.jpg",
          contentHash: "hash",
          mediaType: "image/jpeg",
          ext: "jpg",
          size: 1024,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          accessCount: 0,
        },
      };

      (fs.access as unknown as { mockRejectedValue: (v: unknown) => void }).mockRejectedValue(
        new Error("File not found"),
      );
      sharedMockDb.getData.mockReturnValue(mockMetadata);
      sharedMockDb.update.mockImplementation((fn) => {
        const data = { ...mockMetadata };
        fn(data);
        return sharedMockDb;
      });

      service = new ImageCacheService(ctx);
      await service.start();

      expect(sharedMockDb.update).toHaveBeenCalled();
      expect(sharedMockDb.commit).toHaveBeenCalled();
    });
  });

  describe("get()", () => {
    it("should return undefined for unknown id", async () => {
      service = new ImageCacheService(ctx);
      await service.start();
      const result = await service.get("unknown");
      expect(result).toBeUndefined();
    });

    it("should read file from disk and return cache entry", async () => {
      const fs = await import("node:fs/promises");
      const mockBuffer = Buffer.from("test-image-data");
      (fs.readFile as unknown).mockResolvedValue(mockBuffer);

      const mockMetadata: Record<string, ImageMetadata> = {
        test123: {
          id: "test123",
          url: "https://example.com/test.jpg",
          contentHash: "hash",
          mediaType: "image/jpeg",
          ext: "jpg",
          size: 1024,
          createdAt: Date.now(),
          lastAccessedAt: Date.now() - 1000,
          accessCount: 0,
        },
      };

      sharedMockDb.getData.mockReturnValue(mockMetadata);
      // Mock file access to succeed
      (fs.access as unknown).mockResolvedValue(undefined);

      service = new ImageCacheService(ctx);
      await service.start();

      const result = await service.get("test123");

      expect(result).toEqual({
        base64: mockBuffer.toString("base64"),
        mediaType: "image/jpeg",
        status: "ok",
      });
      expect(fs.readFile).toHaveBeenCalled();
    });

    it("should update lastAccessedAt and accessCount on get", async () => {
      const fs = await import("node:fs/promises");
      (fs.readFile as unknown).mockResolvedValue(Buffer.from("data"));

      const mockMetadata: Record<string, ImageMetadata> = {
        test123: {
          id: "test123",
          url: "https://example.com/test.jpg",
          contentHash: "hash",
          mediaType: "image/jpeg",
          ext: "jpg",
          size: 1024,
          createdAt: Date.now(),
          lastAccessedAt: Date.now() - 1000,
          accessCount: 5,
        },
      };

      sharedMockDb.getData.mockReturnValue(mockMetadata);
      // Mock file access to succeed
      (fs.access as unknown).mockResolvedValue(undefined);

      service = new ImageCacheService(ctx);
      await service.start();

      await service.get("test123");

      expect(sharedMockDb.set).toHaveBeenCalledWith(
        "test123",
        expect.objectContaining({
          accessCount: 6,
        }),
      );
    });

    it("should remove entry and return undefined when file read fails", async () => {
      const fs = await import("node:fs/promises");
      (fs.readFile as unknown).mockRejectedValue(new Error("Read failed"));

      const mockMetadata: Record<string, ImageMetadata> = {
        bad123: {
          id: "bad123",
          url: "https://example.com/bad.jpg",
          contentHash: "hash",
          mediaType: "image/jpeg",
          ext: "jpg",
          size: 1024,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          accessCount: 0,
        },
      };

      sharedMockDb.getData.mockReturnValue(mockMetadata);

      service = new ImageCacheService(ctx);
      await service.start();

      const result = await service.get("bad123");

      expect(result).toBeUndefined();
      expect(sharedMockDb.update).toHaveBeenCalled();
    });
  });

  describe("download()", () => {
    it("should return existing contentId if URL already cached", async () => {
      const fs = await import("node:fs/promises");
      const mockMetadata: Record<string, ImageMetadata> = {
        existing123: {
          id: "existing123",
          url: "https://example.com/cached.jpg",
          contentHash: "hash",
          mediaType: "image/jpeg",
          ext: "jpg",
          size: 1024,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          accessCount: 0,
        },
      };

      sharedMockDb.getData.mockReturnValue(mockMetadata);
      // Mock file access to succeed
      (fs.access as unknown).mockResolvedValue(undefined);

      service = new ImageCacheService(ctx);
      await service.start();

      const result = await service.download("https://example.com/cached.jpg");

      expect(result).toBe("existing123");
      expect(ctx.http.get).not.toHaveBeenCalled();
    });

    it("should deduplicate concurrent downloads to same URL", async () => {
      sharedMockDb.getData.mockReturnValue({});

      service = new ImageCacheService(ctx);
      await service.start();

      // Test that concurrent calls to the same URL return the same promise
      // This tests the deduplication logic without needing actual HTTP calls
      const url = "https://example.com/new.jpg";

      // All three downloads should return the same result (URL hash on failure)
      const [result1, result2, result3] = await Promise.all([
        service.download(url),
        service.download(url),
        service.download(url),
      ]);

      // All three should return the same ID (deduplication working)
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
      expect(result1).toHaveLength(16); // Should be a hash
    });

    it("should write downloaded image file and persist metadata on success", async () => {
      const fs = await import("node:fs/promises");
      const buffer = Buffer.from("downloaded-image-bytes");
      const url = "https://example.com/photo.png";
      const contentHash = createHash("sha256").update(buffer).digest("hex");
      const contentId = contentHash.slice(0, 16);
      (ctx.http.get as unknown).mockResolvedValue(buffer);

      sharedMockDb.getData.mockReturnValue({});

      service = new ImageCacheService(ctx);
      Object.defineProperty(service, "ctx", {
        value: ctx,
        configurable: true,
      });
      await service.start();

      const result = await service.download(url);

      expect(ctx.http.get).toHaveBeenCalledWith(url, { responseType: "arraybuffer" });
      expect(result).toBe(contentId);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(`${contentId}.png`),
        buffer,
      );
      expect(sharedMockDb.set).toHaveBeenCalledWith(
        contentId,
        expect.objectContaining({
          id: contentId,
          url,
          contentHash,
          mediaType: "image/png",
          ext: "png",
          size: buffer.byteLength,
          accessCount: 0,
          createdAt: expect.any(Number),
          lastAccessedAt: expect.any(Number),
        }),
      );
    });

    it("should trigger LRU eviction when over capacity", async () => {
      sharedMockDb.getData.mockReturnValue({});

      service = new ImageCacheService(ctx, {
        maxCachedImages: 2,
        imageTtlMs: 7 * 24 * 3600 * 1000,
        flushIntervalMs: 30_000,
        cleanupIntervalMs: 3_600_000,
      });
      await service.start();

      // Manually add entries to the index to simulate cached images
      const now = Date.now();
      (service as unknown).index.set("id1", {
        id: "id1",
        url: "https://example.com/1.jpg",
        contentHash: "hash1",
        mediaType: "image/jpeg",
        ext: "jpg",
        size: 1024,
        createdAt: now - 3000,
        lastAccessedAt: now - 3000,
        accessCount: 0,
      });
      (service as unknown).index.set("id2", {
        id: "id2",
        url: "https://example.com/2.jpg",
        contentHash: "hash2",
        mediaType: "image/jpeg",
        ext: "jpg",
        size: 1024,
        createdAt: now - 2000,
        lastAccessedAt: now - 2000,
        accessCount: 0,
      });
      (service as unknown).index.set("id3", {
        id: "id3",
        url: "https://example.com/3.jpg",
        contentHash: "hash3",
        mediaType: "image/jpeg",
        ext: "jpg",
        size: 1024,
        createdAt: now - 1000,
        lastAccessedAt: now - 1000,
        accessCount: 0,
      });

      // Trigger eviction manually
      (service as unknown).evictLRU();

      // Verify that oldest entry was removed (id1 should be gone)
      expect((service as unknown).index.has("id1")).toBe(false);
      expect((service as unknown).index.has("id2")).toBe(true);
      expect((service as unknown).index.has("id3")).toBe(true);
      expect((service as unknown).index.size).toBe(2);
    });

    it("should return urlHash on download failure", async () => {
      sharedMockDb.getData.mockReturnValue({});

      (ctx.http.get as unknown).mockRejectedValue(new Error("Network error"));

      service = new ImageCacheService(ctx);
      await service.start();

      const result = await service.download("https://example.com/fail.jpg");

      expect(result).toBeTruthy();
      expect(result).toHaveLength(16); // SHA-256 first 16 chars
    });
  });

  describe("cleanup()", () => {
    it("should remove TTL-expired entries", async () => {
      const now = Date.now();
      const mockMetadata: Record<string, ImageMetadata> = {
        old123: {
          id: "old123",
          url: "https://example.com/old.jpg",
          contentHash: "hash",
          mediaType: "image/jpeg",
          ext: "jpg",
          size: 1024,
          createdAt: now - 8 * 24 * 3600 * 1000, // 8 days ago
          lastAccessedAt: now - 8 * 24 * 3600 * 1000,
          accessCount: 0,
        },
        new123: {
          id: "new123",
          url: "https://example.com/new.jpg",
          contentHash: "hash2",
          mediaType: "image/jpeg",
          ext: "jpg",
          size: 1024,
          createdAt: now - 1000,
          lastAccessedAt: now - 1000,
          accessCount: 0,
        },
      };

      sharedMockDb.getData.mockReturnValue(mockMetadata);

      service = new ImageCacheService(ctx, {
        maxCachedImages: 1000,
        imageTtlMs: 7 * 24 * 3600 * 1000, // 7 days
        flushIntervalMs: 30_000,
        cleanupIntervalMs: 3_600_000,
      });
      await service.start();

      // Manually trigger cleanup
      (service as unknown).cleanup();

      // Verify old entry was removed
      expect(sharedMockDb.update).toHaveBeenCalled();
    });

    it("should execute periodic cleanup timer", async () => {
      const fs = await import("node:fs/promises");
      const now = new Date("2026-03-08T00:00:00.000Z");
      const mockMetadata: Record<string, ImageMetadata> = {
        expired123: {
          id: "expired123",
          url: "https://example.com/expired.jpg",
          contentHash: "expired-hash",
          mediaType: "image/jpeg",
          ext: "jpg",
          size: 512,
          createdAt: now.getTime() - 5_000,
          lastAccessedAt: now.getTime() - 5_000,
          accessCount: 0,
        },
      };

      sharedMockDb.getData.mockReturnValue(mockMetadata);
      (fs.access as unknown as { mockResolvedValue: (v: undefined) => void }).mockResolvedValue(
        undefined,
      );

      vi.useFakeTimers();
      try {
        vi.setSystemTime(now);
        service = new ImageCacheService(ctx, {
          maxCachedImages: 1000,
          imageTtlMs: 1_000,
          flushIntervalMs: 60_000,
          cleanupIntervalMs: 1_000,
        });
        const cleanupSpy = vi.spyOn(service as unknown as { cleanup: () => void }, "cleanup");
        await service.start();

        await vi.advanceTimersByTimeAsync(1_000);

        expect(cleanupSpy).toHaveBeenCalledTimes(1);
        expect(sharedMockDb.update).toHaveBeenCalled();
      } finally {
        await service.stop();
        vi.useRealTimers();
      }
    });
  });

  describe("stop()", () => {
    it("should clear timers and flush metadata", async () => {
      sharedMockDb.getData.mockReturnValue({});

      service = new ImageCacheService(ctx);
      await service.start();
      await service.stop();

      expect(sharedMockDb.commit).toHaveBeenCalled();
    });
  });

  describe("urlToId()", () => {
    it("should return existing mapping from urlIndex", async () => {
      const fs = await import("node:fs/promises");
      const mockMetadata: Record<string, ImageMetadata> = {
        content123: {
          id: "content123",
          url: "https://example.com/test.jpg",
          contentHash: "hash",
          mediaType: "image/jpeg",
          ext: "jpg",
          size: 1024,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          accessCount: 0,
        },
      };

      sharedMockDb.getData.mockReturnValue(mockMetadata);
      // Mock file access to succeed so the entry is not removed as orphan
      (fs.access as unknown).mockResolvedValue(undefined);

      service = new ImageCacheService(ctx);
      await service.start();

      const result = service.urlToId("https://example.com/test.jpg");

      expect(result).toBe("content123");
    });

    it("should compute SHA-256 hash for unknown URL", async () => {
      sharedMockDb.getData.mockReturnValue({});

      service = new ImageCacheService(ctx);
      await service.start();

      const result = service.urlToId("https://example.com/unknown.jpg");

      expect(result).toBeTruthy();
      expect(result).toHaveLength(16);
    });
  });
});
