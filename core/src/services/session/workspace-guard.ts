import { resolve, sep } from "node:path";

import type { Tool as AiTool, ToolExecutionOptions } from "@ai-sdk/provider-utils";

import type { ChannelKey } from "./types";

export interface SecurityEvent {
  channel: ChannelKey;
  sessionId: string;
  actionType: string;
  allowed: boolean;
  path?: string;
  reason: string;
}

export const HIGH_RISK_ACTIONS = [
  "file_write",
  "file_delete",
  "command_exec",
  "network_request",
] as const;

export function validateWorkspacePath(filePath: string, workspaceRoot: string): boolean {
  const resolvedPath = resolve(filePath);
  const resolvedWorkspaceRoot = resolve(workspaceRoot);

  if (resolvedPath === resolvedWorkspaceRoot) {
    return true;
  }

  const rootedWorkspace = resolvedWorkspaceRoot.endsWith(sep)
    ? resolvedWorkspaceRoot
    : `${resolvedWorkspaceRoot}${sep}`;

  return resolvedPath.startsWith(rootedWorkspace);
}

export function logSecurityEvent(
  logger: { warn: (message: string, meta: Record<string, unknown>) => void },
  event: SecurityEvent,
): void {
  logger.warn("workspace-security-event", {
    channel: event.channel,
    sessionId: event.sessionId,
    actionType: event.actionType,
    allowed: event.allowed,
    path: event.path,
    reason: event.reason,
  });
}

export function inferActionType(toolName: string): string {
  const normalizedToolName = toolName.toLowerCase();
  if (/write|save|create|update|edit/.test(normalizedToolName)) {
    return "file_write";
  }
  if (/delete|remove|unlink|rm/.test(normalizedToolName)) {
    return "file_delete";
  }
  if (/exec|command|shell|terminal|bash/.test(normalizedToolName)) {
    return "command_exec";
  }
  if (/network|http|fetch|request|url|search|browse/.test(normalizedToolName)) {
    return "network_request";
  }
  return toolName;
}

function isPathKey(key: string): boolean {
  return /path|file|dir|directory|cwd|target/i.test(key);
}

function looksLikePath(value: string): boolean {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return false;
  }

  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

export function collectPathCandidates(input: unknown): string[] {
  const candidates = new Set<string>();

  const visit = (value: unknown, keyHint?: string): void => {
    if (typeof value === "string") {
      if (looksLikePath(value) && (!keyHint || isPathKey(keyHint))) {
        candidates.add(value);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        visit(child, key);
      }
    }
  };

  visit(input);
  return [...candidates];
}

export function isHighRiskAction(actionType: string): boolean {
  return HIGH_RISK_ACTIONS.includes(actionType as (typeof HIGH_RISK_ACTIONS)[number]);
}

export interface WorkspaceGuardContext {
  workspaceRoot: string;
  channelKey: ChannelKey;
  sessionId: string;
  logger: { warn: (message: string, meta: Record<string, unknown>) => void };
}

export function wrapToolWithWorkspaceGuard(
  toolName: string,
  tool: AiTool,
  context: WorkspaceGuardContext,
): AiTool {
  if (!tool.execute) {
    return tool;
  }

  const originalExecute = tool.execute;
  const actionType = inferActionType(toolName);
  const isHighRisk = isHighRiskAction(actionType);

  const wrappedExecute = async (
    input: unknown,
    options: ToolExecutionOptions,
  ): Promise<unknown> => {
    const pathCandidates = collectPathCandidates(input);

    if (pathCandidates.length === 0) {
      if (isHighRisk) {
        logSecurityEvent(context.logger, {
          channel: context.channelKey,
          sessionId: context.sessionId,
          actionType,
          allowed: true,
          reason: "high_risk_action_without_path",
        });
      }
      return originalExecute(input, options);
    }

    for (const candidatePath of pathCandidates) {
      const allowed = validateWorkspacePath(candidatePath, context.workspaceRoot);

      logSecurityEvent(context.logger, {
        channel: context.channelKey,
        sessionId: context.sessionId,
        actionType,
        allowed,
        path: candidatePath,
        reason: allowed ? "workspace_boundary_allow" : "workspace_boundary_deny",
      });

      if (!allowed) {
        return {
          error: `Access denied: file path '${candidatePath}' is outside workspace boundary`,
          blockedBy: "workspace_guard",
          actionType,
        };
      }
    }

    return originalExecute(input, options);
  };

  return {
    ...tool,
    execute: wrappedExecute,
  };
}

export function wrapToolsWithWorkspaceGuard(
  tools: Record<string, AiTool>,
  context: WorkspaceGuardContext,
): Record<string, AiTool> {
  const wrapped: Record<string, AiTool> = {};

  for (const [name, tool] of Object.entries(tools)) {
    wrapped[name] = wrapToolWithWorkspaceGuard(name, tool, context);
  }

  return wrapped;
}
