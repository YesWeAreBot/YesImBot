/**
 * Image cache type definitions for disk-backed storage.
 */

/**
 * Metadata record persisted to JsonDB.
 */
export interface ImageMetadata {
  /** SHA-256 first 16 hex chars of content bytes */
  id: string;
  /** Original URL */
  url: string;
  /** Full SHA-256 hex of content bytes */
  contentHash: string;
  /** MIME type (image/jpeg, image/png, etc.) */
  mediaType: string;
  /** File extension without dot (jpg, png, gif, webp) */
  ext: string;
  /** File size in bytes */
  size: number;
  /** Creation timestamp (Date.now() epoch ms) */
  createdAt: number;
  /** Last access timestamp (Date.now() epoch ms) for LRU */
  lastAccessedAt: number;
  /** Access counter */
  accessCount: number;
}

/**
 * Return type from get() - matches existing consumer interface.
 */
export interface CacheEntry {
  base64: string;
  mediaType: string;
  status: "ok" | "failed";
}

/**
 * Service configuration.
 */
export interface ImageCacheConfig {
  debugLevel?: number;
  /** Maximum number of cached images before LRU eviction */
  maxCachedImages: number;
  /** Time-to-live in milliseconds (default 7 days) */
  imageTtlMs: number;
  /** Metadata flush interval in milliseconds (default 30 seconds) */
  flushIntervalMs: number;
  /** Cleanup timer interval in milliseconds (default 1 hour) */
  cleanupIntervalMs: number;
}

/**
 * Determine media type from URL extension.
 */
export function mediaTypeFromUrl(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "image/jpeg";
}

/**
 * Determine file extension from media type.
 */
export function extFromMediaType(mediaType: string): string {
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/gif") return "gif";
  if (mediaType === "image/webp") return "webp";
  if (mediaType === "image/jpeg") return "jpg";
  return "jpg";
}
