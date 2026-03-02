import { createHash } from "node:crypto";

import { Context, Service } from "koishi";

declare module "koishi" {
  interface Context {
    "yesimbot.image-cache": ImageCacheService;
  }
}

interface CacheEntry {
  base64: string;
  mediaType: string;
  status: "ok" | "failed";
}

function mediaTypeFromUrl(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "image/jpeg";
}

export class ImageCacheService extends Service {
  private cache = new Map<string, CacheEntry>();
  private urlIndex = new Map<string, string>();

  constructor(ctx: Context) {
    super(ctx, "yesimbot.image-cache", true);
  }

  urlToId(url: string): string {
    return this.urlIndex.get(url) ?? createHash("sha256").update(url).digest("hex").slice(0, 16);
  }

  get(id: string): CacheEntry | undefined {
    return this.cache.get(id);
  }

  async download(url: string): Promise<string> {
    const existing = this.urlIndex.get(url);
    if (existing) return existing;
    try {
      const ab = await this.ctx.http.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
      const contentId = createHash("sha256").update(Buffer.from(ab)).digest("hex").slice(0, 16);
      this.urlIndex.set(url, contentId);
      if (!this.cache.has(contentId)) {
        const base64 = Buffer.from(ab).toString("base64");
        const mediaType = mediaTypeFromUrl(url);
        this.cache.set(contentId, { base64, mediaType, status: "ok" });
      }
      // Remove stale URL-hash entry if it exists
      const urlHash = createHash("sha256").update(url).digest("hex").slice(0, 16);
      if (urlHash !== contentId) this.cache.delete(urlHash);
      return contentId;
    } catch {
      const urlHash = createHash("sha256").update(url).digest("hex").slice(0, 16);
      this.cache.set(urlHash, { base64: "", mediaType: "", status: "failed" });
      return urlHash;
    }
  }

  evict(ids: string[]): void {
    for (const id of ids) this.cache.delete(id);
  }
}
