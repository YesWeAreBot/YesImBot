import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

// ============================================================================
// Settings Interface
// ============================================================================

/**
 * Agent settings with dual-scope (global + local) support.
 * All fields are optional; missing fields use defaults.
 */
export interface Settings {
  // Model
  defaultModel?: string;
  defaultThinkingLevel?:
    | "off"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh";

  // Session behavior
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";

  // Compaction
  compaction?: {
    enabled?: boolean;
    reserveTokens?: number;
    keepRecentTokens?: number;
  };

  // Retry
  retry?: {
    enabled?: boolean;
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };

  // Context
  contextWindow?: number;

  // Extension custom settings
  extensions?: Record<string, unknown>;
}

// ============================================================================
// Default Settings
// ============================================================================

export const DEFAULT_SETTINGS: Required<
  Pick<
    Settings,
    "contextWindow" | "steeringMode" | "followUpMode"
  >
> & {
  compaction: Required<NonNullable<Settings["compaction"]>>;
  retry: Required<NonNullable<Settings["retry"]>>;
} = {
  contextWindow: 128000,
  steeringMode: "all",
  followUpMode: "all",
  compaction: {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
  },
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
  },
};

// ============================================================================
// Settings Storage Interface
// ============================================================================

/**
 * Storage backend interface for settings persistence.
 */
export interface SettingsStorage {
  load(filePath: string): Settings;
  save(filePath: string, data: Settings): void;
}

// ============================================================================
// FileSettingsStorage (Atomic Write via Temp + Rename)
// ============================================================================

/**
 * File-based settings storage with atomic writes.
 * Writes to a temp file first, then renames to avoid partial writes.
 */
export class FileSettingsStorage implements SettingsStorage {
  load(filePath: string): Settings {
    if (!existsSync(filePath)) {
      return {};
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      if (!content.trim()) {
        return {};
      }
      return JSON.parse(content) as Settings;
    } catch (error) {
      // JSON parse error - warn and backup corrupted file
      const message =
        error instanceof Error ? error.message : String(error);
      console.warn(
        `[SettingsManager] Failed to parse ${filePath}: ${message}. Backing up and using empty settings.`,
      );
      this._backupCorruptedFile(filePath);
      return {};
    }
  }

  save(filePath: string, data: Settings): void {
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

/**
 * In-memory settings storage for testing.
 */
export class InMemorySettingsStorage implements SettingsStorage {
  private _store = new Map<string, Settings>();

  load(filePath: string): Settings {
    return this._store.get(filePath) ?? {};
  }

  save(filePath: string, data: Settings): void {
    this._store.set(filePath, structuredClone(data));
  }

  /** Get all stored data (for test assertions) */
  getAll(): Map<string, Settings> {
    return new Map(this._store);
  }

  /** Clear all stored data */
  clear(): void {
    this._store.clear();
  }
}

// ============================================================================
// SettingsManager
// ============================================================================

/**
 * Dual-scope settings manager with global + local merge.
 *
 * - Global settings: `{basePath}/settings.json`
 * - Local settings: `{channelDir}/settings.json`
 * - Merge strategy: local > global > defaults
 * - Auto-persist on set, atomic write
 * - Dirty field tracking, write queue serialization
 */
export class SettingsManager {
  private _globalPath: string;
  private _localPath: string | undefined;
  private _storage: SettingsStorage;
  private _logger?: { warn: (msg: string) => void };

  private _global: Settings = {};
  private _local: Settings = {};
  private _dirtyGlobal = new Set<string>();
  private _dirtyLocal = new Set<string>();
  private _writeQueue: Promise<void> = Promise.resolve();

  constructor(options: {
    globalPath: string;
    localPath?: string;
    storage?: SettingsStorage;
    logger?: { warn: (msg: string) => void };
  }) {
    this._globalPath = options.globalPath;
    this._localPath = options.localPath;
    this._storage = options.storage ?? new FileSettingsStorage();
    this._logger = options.logger;

    // Load initial settings
    this._global = this._storage.load(this._globalPath);
    if (this._localPath) {
      this._local = this._storage.load(this._localPath);
    }
  }

  // =========================================================================
  // Deep Merge Utility
  // =========================================================================

  private _deepMerge(target: Settings, source: Settings): Settings {
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
        result[key] = this._deepMerge(
          targetVal as Settings,
          sourceVal as Settings,
        );
      } else if (sourceVal !== undefined) {
        result[key] = sourceVal;
      }
    }
    return result as Settings;
  }

  // =========================================================================
  // Getters (merged: local > global > defaults)
  // =========================================================================

  /** Get merged settings (local > global > defaults) */
  get settings(): Settings {
    const merged = this._deepMerge(
      this._deepMerge({ ...DEFAULT_SETTINGS }, this._global),
      this._local,
    );
    return merged;
  }

  get contextWindow(): number {
    return this.settings.contextWindow ?? DEFAULT_SETTINGS.contextWindow;
  }

  get compaction(): NonNullable<Settings["compaction"]> {
    return {
      ...DEFAULT_SETTINGS.compaction,
      ...(this._global.compaction ?? {}),
      ...(this._local.compaction ?? {}),
    };
  }

  get retry(): NonNullable<Settings["retry"]> {
    return {
      ...DEFAULT_SETTINGS.retry,
      ...(this._global.retry ?? {}),
      ...(this._local.retry ?? {}),
    };
  }

  get steeringMode(): "all" | "one-at-a-time" {
    return (
      this._local.steeringMode ??
      this._global.steeringMode ??
      DEFAULT_SETTINGS.steeringMode
    );
  }

  get followUpMode(): "all" | "one-at-a-time" {
    return (
      this._local.followUpMode ??
      this._global.followUpMode ??
      DEFAULT_SETTINGS.followUpMode
    );
  }

  get defaultModel(): string | undefined {
    return this._local.defaultModel ?? this._global.defaultModel;
  }

  get defaultThinkingLevel(): Settings["defaultThinkingLevel"] {
    return (
      this._local.defaultThinkingLevel ?? this._global.defaultThinkingLevel
    );
  }

  // =========================================================================
  // Setters (auto-persist to specified scope)
  // =========================================================================

  set(
    key: keyof Settings,
    value: Settings[keyof Settings],
    scope: "global" | "local" = "local",
  ): void {
    const target = scope === "global" ? this._global : this._local;
    const dirty = scope === "global" ? this._dirtyGlobal : this._dirtyLocal;

    (target as Record<string, unknown>)[key] = value;
    dirty.add(key);
    this._enqueueSave(scope);
  }

  setContextWindow(value: number, scope: "global" | "local" = "local"): void {
    this.set("contextWindow", value, scope);
  }

  setCompactionEnabled(
    enabled: boolean,
    scope: "global" | "local" = "local",
  ): void {
    const current = scope === "global" ? this._global : this._local;
    this.set(
      "compaction",
      { ...(current.compaction ?? {}), enabled },
      scope,
    );
  }

  setCompactionReserveTokens(
    tokens: number,
    scope: "global" | "local" = "local",
  ): void {
    const current = scope === "global" ? this._global : this._local;
    this.set(
      "compaction",
      { ...(current.compaction ?? {}), reserveTokens: tokens },
      scope,
    );
  }

  setCompactionKeepRecentTokens(
    tokens: number,
    scope: "global" | "local" = "local",
  ): void {
    const current = scope === "global" ? this._global : this._local;
    this.set(
      "compaction",
      { ...(current.compaction ?? {}), keepRecentTokens: tokens },
      scope,
    );
  }

  setRetryEnabled(
    enabled: boolean,
    scope: "global" | "local" = "local",
  ): void {
    const current = scope === "global" ? this._global : this._local;
    this.set("retry", { ...(current.retry ?? {}), enabled }, scope);
  }

  setRetryMaxRetries(
    maxRetries: number,
    scope: "global" | "local" = "local",
  ): void {
    const current = scope === "global" ? this._global : this._local;
    this.set(
      "retry",
      { ...(current.retry ?? {}), maxRetries },
      scope,
    );
  }

  setRetryBaseDelayMs(
    delayMs: number,
    scope: "global" | "local" = "local",
  ): void {
    const current = scope === "global" ? this._global : this._local;
    this.set(
      "retry",
      { ...(current.retry ?? {}), baseDelayMs: delayMs },
      scope,
    );
  }

  setRetryMaxDelayMs(
    delayMs: number,
    scope: "global" | "local" = "local",
  ): void {
    const current = scope === "global" ? this._global : this._local;
    this.set("retry", { ...(current.retry ?? {}), maxDelayMs: delayMs }, scope);
  }

  setSteeringMode(
    mode: "all" | "one-at-a-time",
    scope: "global" | "local" = "local",
  ): void {
    this.set("steeringMode", mode, scope);
  }

  setFollowUpMode(
    mode: "all" | "one-at-a-time",
    scope: "global" | "local" = "local",
  ): void {
    this.set("followUpMode", mode, scope);
  }

  setDefaultModel(
    model: string | undefined,
    scope: "global" | "local" = "local",
  ): void {
    this.set("defaultModel", model, scope);
  }

  setDefaultThinkingLevel(
    level: Settings["defaultThinkingLevel"],
    scope: "global" | "local" = "local",
  ): void {
    this.set("defaultThinkingLevel", level, scope);
  }

  setExtensionSetting(
    key: string,
    value: unknown,
    scope: "global" | "local" = "local",
  ): void {
    const current = scope === "global" ? this._global : this._local;
    const extensions = { ...(current.extensions ?? {}), [key]: value };
    this.set("extensions", extensions, scope);
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
  // Write Queue & Dirty Tracking
  // =========================================================================

  private _enqueueSave(scope: "global" | "local"): void {
    this._writeQueue = this._writeQueue.then(() =>
      this._saveScope(scope).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this._logger?.warn(`[SettingsManager] Failed to save ${scope} settings: ${message}`);
      }),
    );
  }

  private async _saveScope(scope: "global" | "local"): Promise<void> {
    const dirty = scope === "global" ? this._dirtyGlobal : this._dirtyLocal;
    if (dirty.size === 0) return;

    const filePath =
      scope === "global" ? this._globalPath : this._localPath;
    if (!filePath) return;

    const source = scope === "global" ? this._global : this._local;

    // Build partial object with only dirty fields
    const partial: Settings = {};
    for (const key of dirty) {
      (partial as Record<string, unknown>)[key] = (
        source as Record<string, unknown>
      )[key];
    }

    // Load existing, merge partial, save
    const existing = this._storage.load(filePath);
    const merged = this._deepMerge(existing, partial);
    this._storage.save(filePath, merged);

    dirty.clear();
  }

  /** Wait for all pending writes to complete */
  async flush(): Promise<void> {
    await this._writeQueue;
  }
}
