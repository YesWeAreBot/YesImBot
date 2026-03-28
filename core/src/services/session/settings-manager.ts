import { existsSync, readFileSync } from "node:fs";

export interface AthenaSessionSettings extends Record<string, unknown> {
  model?: string;
  judge?: {
    model?: string;
    enabled?: boolean;
    timeoutMs?: number;
  };
  compaction?: {
    model?: string;
    enabled?: boolean;
    reserveTokens?: number;
    keepRecentTokens?: number;
    contextWindow?: number;
  };
  response?: {
    streaming?: boolean;
    maxSteps?: number;
    baseTimeoutMs?: number;
    perStepTimeoutMs?: number;
    chunkTimeoutMs?: number;
    sendMessageDirectly?: boolean;
  };
  workspace?: {
    enableWorkspace?: boolean;
    enableSandbox?: boolean;
    enableFilesystem?: boolean;
    externalPath?: string[];
  };
  prompts?: {
    builtInInstructions?: string;
  };
}

export interface AthenaWorkspaceSettings extends AthenaSessionSettings {
  useGlobal?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return false;
  }

  return true;
}

export function readSettingsFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const content = readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(content);
    if (!isPlainObject(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

export function deepMergeSettings<T extends Record<string, unknown>>(base: T, overrides: T): T {
  const result: Record<string, unknown> = { ...base };

  for (const [key, overrideValue] of Object.entries(overrides)) {
    if (overrideValue === undefined) {
      continue;
    }

    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMergeSettings(baseValue, overrideValue);
      continue;
    }

    result[key] = overrideValue;
  }

  return result as T;
}

export function stripUseGlobal(settings: AthenaWorkspaceSettings): AthenaSessionSettings {
  const { useGlobal: _, ...rest } = settings;
  return rest;
}

export interface SettingsManagerOptions {
  globalSettingsPath: string;
  workspaceSettingsPath: string;
}

export class SettingsManager {
  private readonly globalSettingsPath: string;
  private readonly workspaceSettingsPath: string;

  constructor(options: SettingsManagerOptions) {
    this.globalSettingsPath = options.globalSettingsPath;
    this.workspaceSettingsPath = options.workspaceSettingsPath;
  }

  loadGlobalSettings(): AthenaSessionSettings {
    return readSettingsFile(this.globalSettingsPath) as AthenaSessionSettings;
  }

  loadWorkspaceSettings(): AthenaWorkspaceSettings {
    return readSettingsFile(this.workspaceSettingsPath) as AthenaWorkspaceSettings;
  }

  usesGlobalSettings(): boolean {
    const workspaceSettings = this.loadWorkspaceSettings();
    return workspaceSettings.useGlobal !== false;
  }

  resolveSettings(): AthenaSessionSettings {
    const globalSettings = this.loadGlobalSettings();
    const workspaceSettings = this.loadWorkspaceSettings();
    const workspaceSettingsWithoutControl = stripUseGlobal(workspaceSettings);

    if (!this.usesGlobalSettings()) {
      return workspaceSettingsWithoutControl;
    }

    return deepMergeSettings(globalSettings, workspaceSettingsWithoutControl);
  }
}
