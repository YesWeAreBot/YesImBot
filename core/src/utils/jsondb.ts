import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class JsonDB<T extends object> {
  private readonly filePath: string;
  private data: T;
  private dirty = false;

  constructor(filePath: string, defaultData: T) {
    this.filePath = filePath;
    this.data = structuredClone(defaultData);
    this.load(defaultData);
  }

  private load(defaultData: T): void {
    if (!existsSync(this.filePath)) {
      this.dirty = true;
      try {
        this.commit();
      } catch (e) {
        console.warn(`[JsonDB] Could not write initial data to ${this.filePath}: ${e}`);
      }
      return;
    }

    try {
      const content = readFileSync(this.filePath, "utf-8");
      this.data = JSON.parse(content) as T;
    } catch (e) {
      console.warn(`[JsonDB] Failed to load ${this.filePath}, using defaults: ${e}`);
      this.data = structuredClone(defaultData);
      this.dirty = true;
    }
  }

  /** Read a top-level key from in-memory data. */
  get<K extends keyof T>(key: K): T[K] {
    return this.data[key];
  }

  /** Write a top-level key in-memory. Changes are not persisted until commit(). */
  set<K extends keyof T>(key: K, value: T[K]): this {
    this.data[key] = value;
    this.dirty = true;
    return this;
  }

  /** Mutate data in-place via a callback. Changes are not persisted until commit(). */
  update(fn: (data: T) => void): this {
    fn(this.data);
    this.dirty = true;
    return this;
  }

  /** Return a read-only snapshot of the in-memory data. */
  getData(): Readonly<T> {
    return this.data;
  }

  /**
   * Persist in-memory data to disk.
   * Only writes when there are uncommitted changes.
   * @throws Error if the file cannot be written.
   */
  commit(): void {
    if (!this.dirty) return;

    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch (e) {
        throw new Error(`[JsonDB] Cannot create directory ${dir}: ${e}`);
      }
    }

    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
      this.dirty = false;
    } catch (e) {
      throw new Error(`[JsonDB] Failed to save ${this.filePath}: ${e}`);
    }
  }

  /**
   * Reload data from disk, discarding any uncommitted in-memory changes.
   * @throws Error if the file cannot be read or parsed.
   */
  reload(): void {
    try {
      const content = readFileSync(this.filePath, "utf-8");
      this.data = JSON.parse(content) as T;
      this.dirty = false;
    } catch (e) {
      throw new Error(`[JsonDB] Failed to reload ${this.filePath}: ${e}`);
    }
  }
}
