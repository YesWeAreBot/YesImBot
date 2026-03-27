import { describe, expect, it, vi } from "vitest";

import {
  HIGH_RISK_ACTIONS,
  logSecurityEvent,
  validateWorkspacePath,
} from "../../src/services/session/workspace-guard";

describe("workspace guard", () => {
  it("allows paths inside the workspace after canonicalization", () => {
    const allowed = validateWorkspacePath(
      "/tmp/athena/workspace/../workspace/notes/todo.md",
      "/tmp/athena/workspace",
    );

    expect(allowed).toBe(true);
  });

  it("blocks paths outside the workspace", () => {
    const allowed = validateWorkspacePath("/tmp/athena/other/secret.txt", "/tmp/athena/workspace");

    expect(allowed).toBe(false);
  });

  it("logs structured security fields", () => {
    const warn = vi.fn();

    logSecurityEvent(
      { warn },
      {
        channel: "discord:channel-1",
        sessionId: "session-1",
        actionType: "file_write",
        allowed: false,
        path: "../secret.txt",
        reason: "workspace_boundary_deny",
      },
    );

    expect(warn).toHaveBeenCalledWith("workspace-security-event", {
      channel: "discord:channel-1",
      sessionId: "session-1",
      actionType: "file_write",
      allowed: false,
      path: "../secret.txt",
      reason: "workspace_boundary_deny",
    });
  });

  it("includes required high-risk action categories", () => {
    expect(HIGH_RISK_ACTIONS).toEqual([
      "file_write",
      "file_delete",
      "command_exec",
      "network_request",
    ]);
  });
});
