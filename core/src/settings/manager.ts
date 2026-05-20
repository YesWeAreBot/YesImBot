import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { DEFAULT_RUNTIME_SETTINGS, type RuntimeSettings } from "./defaults.js";

// ============================================================================
// Partial Settings Type (for file/seed input)
// ============================================================================

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type PartialRuntimeSettings = DeepPartial<RuntimeSettings>;

// ============================================================================
// Settings Storage Interface
// ============================================================================

export interface SettingsStorage {
  load(filePath: string): PartialRuntimeSettings;
  save(filePath: string, data: PartialRuntimeSettings): void;
}

// ============================================================================
// FileSettingsStorage (Atomic Write via Temp + Rename)
// ============================================================================

export class FileSettingsStorage implements SettingsStorage {
  load(filePath: string): PartialRuntimeSettings {
    if (!existsSync(filePath)) {
      return {};
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      if (!content.trim()) {
        return {};
      }
      return JSON.parse(content) as PartialRuntimeSettings;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[RuntimeSettingsManager] Failed to parse ${filePath}: ${message}. Backing up and using empty settings.`,
      );
      this._backupCorruptedFile(filePath);
      return {};
    }
  }

  save(filePath: string, data: PartialRuntimeSettings): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const tempPath = `${filePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tempPath, filePath);
  }

  private _backupCorruptedFile(filePath: string): void {
    try {
      const backupPath = `${filePath}.corrupted-${Date.now()}`;
      renameSync(filePath, backupPath);
    } catch {
      // Ignore backup errors
    }
  }
}

// ============================================================================
// InMemorySettingsStorage (For Testing)
// ============================================================================

export class InMemorySettingsStorage implements SettingsStorage {
  private _store = new Map<string, PartialRuntimeSettings>();

  load(filePath: string): PartialRuntimeSettings {
    return this._store.get(filePath) ?? {};
  }

  save(filePath: string, data: PartialRuntimeSettings): void {
    this._store.set(filePath, structuredClone(data));
  }

  getAll(): Map<string, PartialRuntimeSettings> {
    return new Map(this._store);
  }

  clear(): void {
    this._store.clear();
  }
}

// ============================================================================
// RuntimeSettingsManager
// ============================================================================

/**
 * Four-layer runtime settings manager.
 *
 * Merge order (lowest to highest priority):
 *   defaults < Koishi seed < global settings.json < local settings.json
 *
 * - Koishi seed only fills missing fields; it never overwrites file values.
 * - Global/local settings files are the runtime authority.
 * - Auto-persist on set, atomic write, dirty field tracking.
 */
export class RuntimeSettingsManager {
  private _globalPath: string;
  private _localPath: string | undefined;
  private _storage: SettingsStorage;

  private _global: PartialRuntimeSettings = {};
  private _local: PartialRuntimeSettings = {};
  private _dirtyGlobal = new Set<string>();
  private _dirtyLocal = new Set<string>();
  private _writeQueue: Promise<void> = Promise.resolve();

  constructor(options: {
    globalPath: string;
    localPath?: string;
    seed?: PartialRuntimeSettings;
    storage?: SettingsStorage;
  }) {
    this._globalPath = options.globalPath;
    this._localPath = options.localPath;
    this._storage = options.storage ?? new FileSettingsStorage();

    // Load file settings
    this._global = this._storage.load(this._globalPath);
    if (this._localPath) {
      this._local = this._storage.load(this._localPath);
    }

    // Apply seed: fill missing fields in global without overwriting existing values
    if (options.seed) {
      this._global = deepMerge(structuredClone(options.seed), this._global);
      // Persist the seeded global so future starts don't need the seed again
      this._storage.save(this._globalPath, this._global);
    }
  }

  // =========================================================================
  // Getters (merged: defaults < seed(merged into global) < global < local)
  // =========================================================================

  /** Get fully merged settings */
  get settings(): RuntimeSettings {
    return deepMerge(
      deepMerge(structuredClone(DEFAULT_RUNTIME_SETTINGS), this._global),
      this._local,
    ) as RuntimeSettings;
  }

  get contextWindow(): number {
    return this.settings.contextWindow;
  }

  get compaction(): RuntimeSettings["compaction"] {
    return this.settings.compaction;
  }

  get retry(): RuntimeSettings["retry"] {
    return this.settings.retry;
  }

  get steeringMode(): "all" | "one-at-a-time" {
    return this.settings.steeringMode;
  }

  get followUpMode(): "all" | "one-at-a-time" {
    return this.settings.followUpMode;
  }

  get delivery(): RuntimeSettings["delivery"] {
    return this.settings.delivery;
  }

  // =========================================================================
  // Setters (auto-persist to specified scope)
  // =========================================================================

  setContextWindow(value: number, scope: "global" | "local" = "local"): void {
    this._set("contextWindow", value, scope);
  }

  setCompactionEnabled(enabled: boolean, scope: "global" | "local" = "local"): void {
    const current = scope === "global" ? this._global : this._local;
    this._set("compaction", { ...(current.compaction ?? {}), enabled }, scope);
  }

  setCompactionReserveTokens(tokens: number, scope: "global" | "local" = "local"): void {
    const current = scope === "global" ? this._global : this._local;
    this._set("compaction", { ...(current.compaction ?? {}), reserveTokens: tokens }, scope);
  }

  setCompactionKeepRecentTokens(tokens: number, scope: "global" | "local" = "local"): void {
    const current = scope === "global" ? this._global : this._local;
    this._set("compaction", { ...(current.compaction ?? {}), keepRecentTokens: tokens }, scope);
  }

  setRetryEnabled(enabled: boolean, scope: "global" | "local" = "local"): void {
    const current = scope === "global" ? this._global : this._local;
    this._set("retry", { ...(current.retry ?? {}), enabled }, scope);
  }

  setRetryMaxRetries(maxRetries: number, scope: "global" | "local" = "local"): void {
    const current = scope === "global" ? this._global : this._local;
    this._set("retry", { ...(current.retry ?? {}), maxRetries }, scope);
  }

  setRetryBaseDelayMs(delayMs: number, scope: "global" | "local" = "local"): void {
    const current = scope === "global" ? this._global : this._local;
    this._set("retry", { ...(current.retry ?? {}), baseDelayMs: delayMs }, scope);
  }

  setRetryMaxDelayMs(delayMs: number, scope: "global" | "local" = "local"): void {
    const current = scope === "global" ? this._global : this._local;
    this._set("retry", { ...(current.retry ?? {}), maxDelayMs: delayMs }, scope);
  }

  setSteeringMode(mode: "all" | "one-at-a-time", scope: "global" | "local" = "local"): void {
    this._set("steeringMode", mode, scope);
  }

  setFollowUpMode(mode: "all" | "one-at-a-time", scope: "global" | "local" = "local"): void {
    this._set("followUpMode", mode, scope);
  }

  // =========================================================================
  // Reload
  // =========================================================================

  reload(): void {
    this._global = this._storage.load(this._globalPath);
    if (this._localPath) {
      this._local = this._storage.load(this._localPath);
    }
  }

  // =========================================================================
  // Internal: set + persist
  // =========================================================================

  private _set(key: keyof RuntimeSettings, value: unknown, scope: "global" | "local"): void {
    const target = scope === "global" ? this._global : this._local;
    const dirty = scope === "global" ? this._dirtyGlobal : this._dirtyLocal;

    (target as Record<string, unknown>)[key] = value;
    dirty.add(key);
    this._enqueueSave(scope);
  }

  private _enqueueSave(scope: "global" | "local"): void {
    this._writeQueue = this._writeQueue.then(() => this._saveScope(scope).catch(() => {}));
  }

  private async _saveScope(scope: "global" | "local"): Promise<void> {
    const dirty = scope === "global" ? this._dirtyGlobal : this._dirtyLocal;
    if (dirty.size === 0) return;

    const filePath = scope === "global" ? this._globalPath : this._localPath;
    if (!filePath) return;

    const source = scope === "global" ? this._global : this._local;

    // Build partial object with only dirty fields
    const partial: PartialRuntimeSettings = {};
    for (const key of dirty) {
      (partial as Record<string, unknown>)[key] = (source as Record<string, unknown>)[key];
    }

    // Load existing, merge partial, save
    const existing = this._storage.load(filePath);
    const merged = deepMerge(existing, partial);
    this._storage.save(filePath, merged);

    dirty.clear();
  }

  /** Wait for all pending writes to complete */
  async flush(): Promise<void> {
    await this._writeQueue;
  }
}

// ============================================================================
// Deep Merge Utility
// ============================================================================

function deepMerge(
  target: PartialRuntimeSettings,
  source: PartialRuntimeSettings,
): PartialRuntimeSettings {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = (source as Record<string, unknown>)[key];
    const targetVal = result[key];
    if (
      sourceVal !== undefined &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      targetVal !== undefined &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as PartialRuntimeSettings,
        sourceVal as PartialRuntimeSettings,
      );
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }
  return result as PartialRuntimeSettings;
}
