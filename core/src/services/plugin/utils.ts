import type { ToolResult } from "./types";

export function Success<T>(result?: T): ToolResult<T> {
  return { ok: true, data: result as T };
}

export function Failed(error: string, metadata?: Record<string, unknown>): ToolResult {
  return { ok: false, error, metadata };
}
