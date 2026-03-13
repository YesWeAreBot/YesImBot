import type { LoadAttempt, LoadResult, LoadResultStatus, SkillDefinition } from "./types";

export class LoadedSkillSet {
  private loaded = new Map<string, SkillDefinition>();
  private loadHistory: LoadAttempt[] = [];

  load(skill: SkillDefinition): LoadResult {
    if (this.loaded.has(skill.name)) {
      this.loadHistory.push({
        name: skill.name,
        status: "already_loaded",
        timestamp: Date.now(),
      });
      return { status: "already_loaded", skill };
    }

    this.loaded.set(skill.name, skill);
    this.loadHistory.push({
      name: skill.name,
      status: "loaded",
      timestamp: Date.now(),
    });
    return { status: "loaded", skill };
  }

  recordLoadAttempt(
    name: string,
    status: LoadResultStatus,
    reason?: string,
    caller?: string,
  ): void {
    this.loadHistory.push({
      name,
      status,
      timestamp: Date.now(),
      reason,
      caller,
    });
  }

  unload(name: string): boolean {
    const existed = this.loaded.delete(name);
    if (existed) {
      this.loadHistory.push({
        name,
        status: "unloaded",
        timestamp: Date.now(),
      });
    }
    return existed;
  }

  has(name: string): boolean {
    return this.loaded.has(name);
  }

  get(name: string): SkillDefinition | undefined {
    return this.loaded.get(name);
  }

  getLoaded(): SkillDefinition[] {
    return Array.from(this.loaded.values());
  }

  getLoadedNames(): string[] {
    return Array.from(this.loaded.keys());
  }

  getLoadHistory(): LoadAttempt[] {
    return [...this.loadHistory];
  }

  get size(): number {
    return this.loaded.size;
  }
}
