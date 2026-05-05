import type { ExtensionRunner } from "./runner.js";
import type { ExtensionDefinition } from "./types.js";

export class ExtensionRegistry {
  private definitions = new Map<string, ExtensionDefinition>();
  private runners = new Set<ExtensionRunner>();

  add(def: ExtensionDefinition): void {
    this.definitions.set(def.id, def);
    this._broadcast();
  }

  remove(id: string): void {
    this.definitions.delete(id);
    this._broadcast();
  }

  get(id: string): ExtensionDefinition | undefined {
    return this.definitions.get(id);
  }

  getAll(): ExtensionDefinition[] {
    return Array.from(this.definitions.values());
  }

  registerRunner(runner: ExtensionRunner): void {
    this.runners.add(runner);
  }

  unregisterRunner(runner: ExtensionRunner): void {
    this.runners.delete(runner);
  }

  /** 异步广播到所有 runners，fire-and-forget */
  private _broadcast(): void {
    const defs = this.getAll();
    for (const runner of this.runners) {
      runner.reload(defs).catch((err) => {
        console.error("[ExtensionRegistry] reload failed:", err);
      });
    }
  }
}
