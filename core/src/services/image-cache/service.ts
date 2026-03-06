import { createHash } from "node:crypto";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Context, Service } from "koishi";

import { JsonDB } from "../../utils";
import type { CacheEntry, ImageCacheConfig, ImageMetadata } from "./types";
import { extFromMediaType, mediaTypeFromUrl } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.image-cache": ImageCacheService;
  }
}

export class ImageCacheService extends Service {
  private index = new Map<string, ImageMetadata>();
  private urlIndex = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private db!: JsonDB<Record<string, ImageMetadata>>;
  private cacheDir: string;
  private imagesDir: string;
  private flushTimer?: ReturnType<typeof setInterval>;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private config: ImageCacheConfig;
  private logger;

  constructor(ctx: Context, config?: Partial<ImageCacheConfig>) {
    super(ctx, "yesimbot.image-cache", false);
    this.logger = ctx.logger("yesimbot.image-cache");
    this.cacheDir = join(ctx.baseDir, "data", "yesimbot", "cache");
    this.imagesDir = join(this.cacheDir, "images");
    this.config = {
      maxCachedImages: config?.maxCachedImages ?? 1000,
      imageTtlMs: config?.imageTtlMs ?? 7 * 24 * 3600 * 1000,
      flushIntervalMs: config?.flushIntervalMs ?? 30_000,
      cleanupIntervalMs: config?.cleanupIntervalMs ?? 3_600_000,
    };
  }

  async start(): Promise<void> {
    // Create cache directories
    await mkdir(this.imagesDir, { recursive: true });

    // Initialize JsonDB
    this.db = new JsonDB(join(this.cacheDir, "metadata.json"), {});

    // Preload index and clean orphans
    const metadata = this.db.getData();
    const orphanIds: string[] = [];

    for (const [id, meta] of Object.entries(metadata)) {
      const filePath = join(this.imagesDir, `${meta.id}.${meta.ext}`);
      try {
        await access(filePath);
        this.index.set(id, meta);
        this.urlIndex.set(meta.url, meta.id);
      } catch {
        orphanIds.push(id);
      }
    }

    // Remove orphan metadata
    if (orphanIds.length > 0) {
      this.db.update((data) => {
        for (const id of orphanIds) {
          delete data[id];
        }
      });
      this.db.commit();
      this.logger.info(`Removed ${orphanIds.length} orphan metadata entries`);
    }

    // Start periodic timers
    this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs);
    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.flush();
  }

  async get(id: string): Promise<CacheEntry | undefined> {
    const meta = this.index.get(id);
    if (!meta) return undefined;

    const filePath = join(this.imagesDir, `${meta.id}.${meta.ext}`);
    try {
      const buffer = await readFile(filePath);

      // Update access tracking immutably
      const updatedMeta: ImageMetadata = {
        ...meta,
        lastAccessedAt: Date.now(),
        accessCount: meta.accessCount + 1,
      };

      this.index.set(id, updatedMeta);
      this.db.set(id, updatedMeta);

      return {
        base64: buffer.toString("base64"),
        mediaType: meta.mediaType,
        status: "ok",
      };
    } catch (error) {
      this.logger.warn(`Failed to read image file ${filePath}, removing entry: ${error}`);
      this.removeEntry(id);
      return undefined;
    }
  }

  async download(url: string): Promise<string> {
    // Check if already cached
    const existing = this.urlIndex.get(url);
    if (existing && this.index.has(existing)) {
      return existing;
    }

    // Check if download is in progress
    const inflight = this.pending.get(url);
    if (inflight) {
      return await inflight;
    }

    // Start new download
    const promise = this.doDownload(url);
    this.pending.set(url, promise);

    try {
      return await promise;
    } finally {
      this.pending.delete(url);
    }
  }

  private async doDownload(url: string): Promise<string> {
    try {
      const ab = await this.ctx.http.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
      const buffer = Buffer.from(ab);

      // Compute content hash
      const contentHash = createHash("sha256").update(buffer).digest("hex");
      const contentId = contentHash.slice(0, 16);

      // Check if content already exists (content deduplication)
      if (this.index.has(contentId)) {
        this.urlIndex.set(url, contentId);
        return contentId;
      }

      // Determine media type and extension
      const mediaType = mediaTypeFromUrl(url);
      const ext = extFromMediaType(mediaType);

      // Write file to disk
      const filePath = join(this.imagesDir, `${contentId}.${ext}`);
      try {
        await writeFile(filePath, buffer);
      } catch (error) {
        this.logger.warn(`Failed to write image file ${filePath}: ${error}`);
        // Continue anyway - metadata is still valid for retry
      }

      // Create metadata
      const now = Date.now();
      const metadata: ImageMetadata = {
        id: contentId,
        url,
        contentHash,
        mediaType,
        ext,
        size: buffer.byteLength,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
      };

      // Store in index, urlIndex, and db
      this.index.set(contentId, metadata);
      this.urlIndex.set(url, contentId);
      this.db.set(contentId, metadata);

      // Trigger LRU eviction if over capacity
      this.evictLRU();

      return contentId;
    } catch (error) {
      // Network error - compute URL hash and return (don't persist)
      this.logger.warn(`Failed to download image from ${url}: ${error}`);
      const urlHash = createHash("sha256").update(url).digest("hex").slice(0, 16);
      return urlHash;
    }
  }

  urlToId(url: string): string {
    return this.urlIndex.get(url) ?? createHash("sha256").update(url).digest("hex").slice(0, 16);
  }

  private removeEntry(id: string): void {
    const meta = this.index.get(id);
    if (!meta) return;

    // Remove from index and urlIndex
    this.index.delete(id);
    this.urlIndex.delete(meta.url);

    // Remove from db
    this.db.update((data) => {
      delete data[id];
    });

    // Delete file in background (ignore errors)
    const filePath = join(this.imagesDir, `${meta.id}.${meta.ext}`);
    unlink(filePath).catch(() => {});
  }

  private flush(): void {
    try {
      this.db.commit();
    } catch (error) {
      this.logger.warn(`Failed to flush metadata: ${error}`);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [id, meta] of this.index.entries()) {
      if (now - meta.createdAt > this.config.imageTtlMs) {
        expiredIds.push(id);
      }
    }

    if (expiredIds.length > 0) {
      for (const id of expiredIds) {
        this.removeEntry(id);
      }
      this.logger.info(`Cleaned up ${expiredIds.length} expired images`);
    }
  }

  private evictLRU(): void {
    if (this.index.size <= this.config.maxCachedImages) {
      return;
    }

    // Sort by lastAccessedAt ascending (oldest first)
    const entries = Array.from(this.index.values()).sort(
      (a, b) => a.lastAccessedAt - b.lastAccessedAt,
    );

    // Remove oldest entries until we're at capacity
    const toRemove = this.index.size - this.config.maxCachedImages;
    for (let i = 0; i < toRemove; i++) {
      this.removeEntry(entries[i].id);
    }

    this.logger.info(`Evicted ${toRemove} images via LRU`);
  }
}
