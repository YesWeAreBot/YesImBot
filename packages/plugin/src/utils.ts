import type { ToolResult } from "./types";

export function Success<T>(result?: T): ToolResult<T> {
  return { status: "success", content: result };
}

export function Failed(message: string): ToolResult {
  return { status: "failed", error: message };
}
