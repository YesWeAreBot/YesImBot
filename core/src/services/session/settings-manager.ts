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
  };
  workspace?: {
    enableWorkspace?: boolean;
    enableSandbox?: boolean;
    enableFilesystem?: boolean;
    externalPath?: string[];
    skills?: string[];
  };
  prompts?: {
    builtInInstructions?: string;
    attachedInstructionFiles?: string[];
  };
}

export interface AthenaWorkspaceSettings extends AthenaSessionSettings {
  useGlobal?: boolean;
}

export interface JsonSchemaDefinition {
  [key: string]: unknown;
}

export const ATHENA_SESSION_SETTINGS_JSON_SCHEMA: JsonSchemaDefinition = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://yesimbot.dev/schemas/athena-session-settings.schema.json",
  title: "Athena Session Settings",
  type: "object",
  additionalProperties: false,
  properties: {
    model: {
      type: "string",
      description: "Override the chat model id for this scope.",
    },
    judge: {
      type: "object",
      additionalProperties: false,
      properties: {
        model: { type: "string" },
        enabled: { type: "boolean" },
        timeoutMs: { type: "number", minimum: 0 },
      },
    },
    compaction: {
      type: "object",
      additionalProperties: false,
      properties: {
        model: { type: "string" },
        enabled: { type: "boolean" },
        reserveTokens: { type: "number", minimum: 0 },
        keepRecentTokens: { type: "number", minimum: 0 },
        contextWindow: { type: "number", minimum: 0 },
      },
    },
    response: {
      type: "object",
      additionalProperties: false,
      properties: {
        streaming: { type: "boolean" },
        maxSteps: { type: "number", minimum: 0 },
        baseTimeoutMs: { type: "number", minimum: 0 },
        perStepTimeoutMs: { type: "number", minimum: 0 },
        chunkTimeoutMs: { type: "number", minimum: 0 },
      },
    },
    workspace: {
      type: "object",
      additionalProperties: false,
      properties: {
        enableWorkspace: { type: "boolean" },
        enableSandbox: { type: "boolean" },
        enableFilesystem: { type: "boolean" },
        externalPath: {
          type: "array",
          items: { type: "string" },
        },
        skills: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    prompts: {
      type: "object",
      additionalProperties: false,
      properties: {
        builtInInstructions: { type: "string" },
        attachedInstructionFiles: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    useGlobal: {
      deprecated: true,
      description: "Deprecated. Ignored by Athena. Workspace settings always layer over global.",
    },
  },
};

export interface SettingsIssue {
  scope: "global" | "workspace";
  path: string;
  code:
    | "invalid-json"
    | "invalid-root"
    | "unknown-key"
    | "invalid-type"
    | "invalid-array-item"
    | "deprecated-key";
  message: string;
  filePath: string;
}

export interface SettingsConflict {
  scope: "global" | "workspace";
  path: string;
  filePath: string;
  baseValue: unknown;
  overrideValue: unknown;
}

export interface SettingsFileSnapshot<T extends Record<string, unknown>> {
  path: string;
  exists: boolean;
  valid: boolean;
  settings: T;
  appliedPaths: string[];
  issues: SettingsIssue[];
}

export interface SettingsReloadMetadata {
  reloadedAt: number;
  precedence: string[];
  sources: {
    global: SettingsFileSnapshot<AthenaSessionSettings>;
    workspace: SettingsFileSnapshot<AthenaWorkspaceSettings>;
  };
  effectiveSettings: AthenaSessionSettings;
  conflicts: SettingsConflict[];
  issues: SettingsIssue[];
}

interface SettingsValidationResult<T extends Record<string, unknown>> {
  settings: T;
  issues: SettingsIssue[];
  appliedPaths: string[];
}

interface SettingsObjectRule {
  kind: "object";
  properties: SettingsRuleMap;
}

interface SettingsArrayRule {
  kind: "string-array";
}

interface SettingsScalarRule {
  kind: "string" | "boolean" | "number";
}

interface DeprecatedRule {
  kind: "deprecated";
  message: string;
}

type SettingsRule = SettingsObjectRule | SettingsArrayRule | SettingsScalarRule | DeprecatedRule;
type SettingsRuleMap = Record<string, SettingsRule>;

const SESSION_SETTINGS_RULES: SettingsRuleMap = {
  model: { kind: "string" },
  judge: {
    kind: "object",
    properties: {
      model: { kind: "string" },
      enabled: { kind: "boolean" },
      timeoutMs: { kind: "number" },
    },
  },
  compaction: {
    kind: "object",
    properties: {
      model: { kind: "string" },
      enabled: { kind: "boolean" },
      reserveTokens: { kind: "number" },
      keepRecentTokens: { kind: "number" },
      contextWindow: { kind: "number" },
    },
  },
  response: {
    kind: "object",
    properties: {
      streaming: { kind: "boolean" },
      maxSteps: { kind: "number" },
      baseTimeoutMs: { kind: "number" },
      perStepTimeoutMs: { kind: "number" },
      chunkTimeoutMs: { kind: "number" },
    },
  },
  workspace: {
    kind: "object",
    properties: {
      enableWorkspace: { kind: "boolean" },
      enableSandbox: { kind: "boolean" },
      enableFilesystem: { kind: "boolean" },
      externalPath: { kind: "string-array" },
      skills: { kind: "string-array" },
    },
  },
  prompts: {
    kind: "object",
    properties: {
      builtInInstructions: { kind: "string" },
      attachedInstructionFiles: { kind: "string-array" },
    },
  },
  useGlobal: {
    kind: "deprecated",
    message:
      "Deprecated key 'useGlobal' is ignored. Workspace settings always layer over global settings.",
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return false;
  }

  return true;
}

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function buildPath(parentPath: string, key: string): string {
  return parentPath ? `${parentPath}.${key}` : key;
}

function cloneSettings<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function loadSettingsSnapshot<T extends Record<string, unknown>>(
  filePath: string,
  scope: "global" | "workspace",
): SettingsFileSnapshot<T> {
  if (!existsSync(filePath)) {
    return {
      path: filePath,
      exists: false,
      valid: true,
      settings: {} as T,
      appliedPaths: [],
      issues: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error: unknown) {
    return {
      path: filePath,
      exists: true,
      valid: false,
      settings: {} as T,
      appliedPaths: [],
      issues: [
        {
          scope,
          path: "$",
          code: "invalid-json",
          message: error instanceof Error ? error.message : String(error),
          filePath,
        },
      ],
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      path: filePath,
      exists: true,
      valid: false,
      settings: {} as T,
      appliedPaths: [],
      issues: [
        {
          scope,
          path: "$",
          code: "invalid-root",
          message: "settings.json root must be an object.",
          filePath,
        },
      ],
    };
  }

  const validation = validateSettingsObject<T>(parsed, scope, filePath, SESSION_SETTINGS_RULES, "");
  return {
    path: filePath,
    exists: true,
    valid: validation.issues.every((issue) => issue.code !== "invalid-json"),
    settings: validation.settings,
    appliedPaths: validation.appliedPaths,
    issues: validation.issues,
  };
}

function validateSettingsObject<T extends Record<string, unknown>>(
  raw: Record<string, unknown>,
  scope: "global" | "workspace",
  filePath: string,
  rules: SettingsRuleMap,
  parentPath: string,
): SettingsValidationResult<T> {
  const result: Record<string, unknown> = {};
  const issues: SettingsIssue[] = [];
  const appliedPaths: string[] = [];

  for (const [key, value] of Object.entries(raw)) {
    const rule = rules[key];
    const currentPath = buildPath(parentPath, key);

    if (!rule) {
      issues.push({
        scope,
        path: currentPath,
        code: "unknown-key",
        message: `Unknown settings key '${currentPath}' was ignored.`,
        filePath,
      });
      continue;
    }

    if (rule.kind === "deprecated") {
      issues.push({
        scope,
        path: currentPath,
        code: "deprecated-key",
        message: rule.message,
        filePath,
      });
      continue;
    }

    if (rule.kind === "object") {
      if (!isPlainObject(value)) {
        issues.push({
          scope,
          path: currentPath,
          code: "invalid-type",
          message: `Expected '${currentPath}' to be an object.`,
          filePath,
        });
        continue;
      }

      const nested = validateSettingsObject<Record<string, unknown>>(
        value,
        scope,
        filePath,
        rule.properties,
        currentPath,
      );
      issues.push(...nested.issues);
      if (Object.keys(nested.settings).length > 0) {
        result[key] = nested.settings;
        appliedPaths.push(...nested.appliedPaths);
      }
      continue;
    }

    if (rule.kind === "string-array") {
      if (!Array.isArray(value)) {
        issues.push({
          scope,
          path: currentPath,
          code: "invalid-type",
          message: `Expected '${currentPath}' to be an array of strings.`,
          filePath,
        });
        continue;
      }

      const normalized = value.flatMap((entry, index) => {
        if (typeof entry === "string") {
          return [entry];
        }

        issues.push({
          scope,
          path: `${currentPath}[${index}]`,
          code: "invalid-array-item",
          message: `Expected '${currentPath}[${index}]' to be a string.`,
          filePath,
        });
        return [];
      });

      result[key] = normalized;
      appliedPaths.push(currentPath);
      continue;
    }

    if (rule.kind === "string") {
      if (typeof value !== "string") {
        issues.push({
          scope,
          path: currentPath,
          code: "invalid-type",
          message: `Expected '${currentPath}' to be a string.`,
          filePath,
        });
        continue;
      }

      result[key] = value;
      appliedPaths.push(currentPath);
      continue;
    }

    if (rule.kind === "boolean") {
      if (typeof value !== "boolean") {
        issues.push({
          scope,
          path: currentPath,
          code: "invalid-type",
          message: `Expected '${currentPath}' to be a boolean.`,
          filePath,
        });
        continue;
      }

      result[key] = value;
      appliedPaths.push(currentPath);
      continue;
    }

    if (!isValidNumber(value)) {
      issues.push({
        scope,
        path: currentPath,
        code: "invalid-type",
        message: `Expected '${currentPath}' to be a finite number.`,
        filePath,
      });
      continue;
    }

    result[key] = value;
    appliedPaths.push(currentPath);
  }

  return {
    settings: result as T,
    issues,
    appliedPaths,
  };
}

export function readSettingsFile(filePath: string): Record<string, unknown> {
  return loadSettingsSnapshot<Record<string, unknown>>(filePath, "global").settings;
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

function getValueAtPath(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!isPlainObject(current)) {
      return undefined;
    }

    return current[segment];
  }, source);
}

function hasValueAtPath(source: Record<string, unknown>, path: string): boolean {
  const segments = path.split(".");
  let current: unknown = source;

  for (const segment of segments) {
    if (!isPlainObject(current) || !(segment in current)) {
      return false;
    }

    current = current[segment];
  }

  return true;
}

function areSettingsValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function collectConflicts(
  scope: "global" | "workspace",
  filePath: string,
  appliedPaths: string[],
  overrides: Record<string, unknown>,
  base: Record<string, unknown>,
): SettingsConflict[] {
  return appliedPaths.flatMap((path) => {
    if (!hasValueAtPath(overrides, path)) {
      return [];
    }

    const overrideValue = getValueAtPath(overrides, path);
    const baseValue = getValueAtPath(base, path);
    if (areSettingsValuesEqual(baseValue, overrideValue)) {
      return [];
    }

    return [
      {
        scope,
        path,
        filePath,
        baseValue,
        overrideValue,
      },
    ];
  });
}

export interface SettingsManagerOptions {
  globalSettingsPath: string;
  workspaceSettingsPath: string;
  defaults?: AthenaSessionSettings;
}

export class SettingsManager {
  private readonly globalSettingsPath: string;
  private readonly workspaceSettingsPath: string;
  private readonly defaults: AthenaSessionSettings;
  private metadata: SettingsReloadMetadata;

  constructor(options: SettingsManagerOptions) {
    this.globalSettingsPath = options.globalSettingsPath;
    this.workspaceSettingsPath = options.workspaceSettingsPath;
    this.defaults = cloneSettings(options.defaults ?? {});
    this.metadata = this.buildReloadMetadata();
  }

  loadGlobalSettings(): AthenaSessionSettings {
    return this.metadata.sources.global.settings;
  }

  loadWorkspaceSettings(): AthenaWorkspaceSettings {
    return this.metadata.sources.workspace.settings;
  }

  usesGlobalSettings(): boolean {
    return true;
  }

  resolveSettings(): AthenaSessionSettings {
    return this.metadata.effectiveSettings;
  }

  reload(): SettingsReloadMetadata {
    this.metadata = this.buildReloadMetadata();
    return this.metadata;
  }

  getReloadMetadata(): SettingsReloadMetadata {
    return this.metadata;
  }

  getModel(): string | undefined {
    return this.metadata.effectiveSettings.model;
  }

  getJudgeSettings(): AthenaSessionSettings["judge"] {
    return this.metadata.effectiveSettings.judge;
  }

  getCompactionSettings(): AthenaSessionSettings["compaction"] {
    return this.metadata.effectiveSettings.compaction;
  }

  getResponseSettings(): AthenaSessionSettings["response"] {
    return this.metadata.effectiveSettings.response;
  }

  getWorkspaceSettings(): AthenaSessionSettings["workspace"] {
    return this.metadata.effectiveSettings.workspace;
  }

  getBuiltInInstructions(fallback?: string): string | undefined {
    return this.metadata.effectiveSettings.prompts?.builtInInstructions ?? fallback;
  }

  getPromptResourceFilenames(fallback?: string[]): string[] | undefined {
    return this.metadata.effectiveSettings.prompts?.attachedInstructionFiles ?? fallback;
  }

  private buildReloadMetadata(): SettingsReloadMetadata {
    const global = loadSettingsSnapshot<AthenaSessionSettings>(this.globalSettingsPath, "global");
    const workspace = loadSettingsSnapshot<AthenaWorkspaceSettings>(
      this.workspaceSettingsPath,
      "workspace",
    );

    const defaults = cloneSettings(this.defaults);
    const globalSettings = cloneSettings(global.settings);
    const workspaceSettings = stripUseGlobal(cloneSettings(workspace.settings));
    const defaultsWithGlobal = deepMergeSettings(defaults, globalSettings);
    const effectiveSettings = deepMergeSettings(defaultsWithGlobal, workspaceSettings);
    const conflicts = [
      ...collectConflicts("global", global.path, global.appliedPaths, globalSettings, defaults),
      ...collectConflicts(
        "workspace",
        workspace.path,
        workspace.appliedPaths,
        workspaceSettings,
        defaultsWithGlobal,
      ),
    ];
    const issues = [...global.issues, ...workspace.issues];

    return {
      reloadedAt: Date.now(),
      precedence: ["workspace", "global", "koishi-config"],
      sources: {
        global,
        workspace,
      },
      effectiveSettings,
      conflicts,
      issues,
    };
  }
}
