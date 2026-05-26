import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { CompactionPrompts } from "@yesimbot/agent";

import type { DeliverySettings } from "../delivery.js";

// ============================================================================
// Runtime Settings Interface
// ============================================================================

/**
 * Athena runtime settings — unified configuration for agent behavior and delivery.
 * Managed by RuntimeSettingsManager in core; consumed by AgentSession as plain config.
 */
export interface RuntimeSettings {
  contextWindow: number;
  compaction: {
    enabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
    prompts?: CompactionPrompts;
  };
  retry: {
    enabled: boolean;
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  delivery: DeliverySettings;
}

// ============================================================================
// Default Settings
// ============================================================================

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  contextWindow: 128000,
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
  steeringMode: "all",
  followUpMode: "all",
  delivery: {
    enabled: true,
    segmentation: {
      sepToken: "<sep/>",
      targetCountWeights: { one: 0.45, two: 0.4, three: 0.15 },
      shortSegmentChars: 6,
      shortTextChars: 25,
    },
    timing: {
      initialDelayMinMs: 300,
      initialDelayMaxMs: 1200,
      followupDelayMinMs: 1200,
      followupDelayMaxMs: 4500,
      maxDelayMs: 6500,
      minimumBufferMinMs: 150,
      minimumBufferMaxMs: 400,
    },
  },
};

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
  // Reload
  // =========================================================================

  reload(): void {
    this._global = this._storage.load(this._globalPath);
    if (this._localPath) {
      this._local = this._storage.load(this._localPath);
    }
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
