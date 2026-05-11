import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Bash, InitialFiles, InMemoryFs, MountableFs, OverlayFs, ReadWriteFs } from "just-bash";

import type { WorkspaceConfig } from "./types";

export class Workspace {
  readonly bash: Bash;
  readonly config: WorkspaceConfig;
  private _initialized = false;

  constructor(config: WorkspaceConfig) {
    this.config = config;

    const fs = this.buildFilesystem();

    this.bash = new Bash({
      fs,
      cwd: config.bash?.cwd ?? "/home/user",
      env: config.bash?.env,
      executionLimits: config.bash?.executionLimits,
      network: config.bash?.network,
      python: config.bash?.python ?? false,
      javascript: config.bash?.javascript ?? false,
    });
  }

  private buildFilesystem(): MountableFs {
    const root = resolve(this.config.root);
    const persistPaths = this.config.filesystem?.persistPaths ?? {};
    const initialFiles = this.config.filesystem?.initialFiles ?? {};
    const memoryFiles: InitialFiles = {};
    for (const [path, to] of Object.entries(initialFiles)) {
      memoryFiles[path] = () => {
        return readFileSync(resolve(to), "utf-8");
      };
    }

    const baseFs = new OverlayFs({ root, mountPoint: "/" });

    const mountableFs = new MountableFs({
      base: new InMemoryFs(memoryFiles),
      mounts: [
        { mountPoint: "/home/workspace", filesystem: baseFs },
        ...Object.entries(persistPaths).map(([mountPoint, hostPath]) => ({
          mountPoint,
          filesystem: new ReadWriteFs({ root: resolve(hostPath) }),
        })),
      ],
    });

    return mountableFs;
  }

  async init(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;
  }

  get defaultTimeoutMs(): number {
    return this.config.bash?.timeoutMs ?? 30000;
  }
}
