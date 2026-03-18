import type { ToolResult } from "./types";

export function Success<T>(result?: T): ToolResult<T> {
  return { success: true, status: "success", content: result };
}

export function Failed(message: string): ToolResult {
  return { success: false, status: "failed", error: message };
}
